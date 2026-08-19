import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workerSource = readFileSync(
  new URL("../worker.js", import.meta.url),
  "utf8"
) + `
export {
  applyDiagnosisExtractions,
  applyQ7Applicability,
  createDiagnosisState,
  ensureDiagnosisState,
  getDiagnosisDecision,
  parseDiagnosisExtractionResponse,
  processMessage,
  processDiagnosisMessage,
  selectNextDiagnosisField,
  shouldUseDiagnosisFlow
};`;

const diagnosis = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`
);

function explicit(state, values) {
  for (const [field, value] of Object.entries(values)) {
    state.answers[field] = {
      value,
      state: "explicit",
      evidence: `${field}=${value}`
    };
  }
  diagnosis.applyQ7Applicability(state);
  return state;
}

function phaseFor(values) {
  return diagnosis.getDiagnosisDecision(
    explicit(diagnosis.createDiagnosisState("2026-01-01T00:00:00.000Z"), values)
  )?.phase;
}

function createKv(initial = {}) {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)])
  );
  return {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
    read(key) {
      return JSON.parse(values.get(key));
    },
    write(key, value) {
      values.set(key, JSON.stringify(value));
    }
  };
}

async function withFetch(mock, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("現行Tally互換のPhase 0〜5を判定する", () => {
  assert.equal(phaseFor({ q1: "A", q10: "A", q2: "A" }), 0);
  assert.equal(phaseFor({ q1: "B", q3: "A" }), 1);
  assert.equal(phaseFor({ q1: "B", q3: "B", q4: "B", q5: "C" }), 2);
  assert.equal(phaseFor({ q1: "C", q10: "C" }), 3);
  assert.equal(phaseFor({ q1: "D" }), 4);
  assert.equal(phaseFor({ q1: "F", q11: "F", q12: "F" }), 5);
});

test("Q1=Aの候補ライン通過はPhase 0より優先される", () => {
  assert.equal(
    phaseFor({
      q1: "A", q10: "D", q2: "A", q6: "E", q7: "D", q8: "D", q9: "A"
    }),
    4
  );
});

test("Q6=AならQ7をnot_applicableにする", () => {
  const state = explicit(diagnosis.createDiagnosisState(), { q6: "A" });
  assert.equal(state.q7Applicability, "not_applicable");
  assert.equal(state.answers.q7.state, "not_applicable");
  assert.equal(state.answers.q7.value, null);
});

test("非JSON、空JSON、空extractionsを抽出なしとして扱う", () => {
  assert.deepEqual(diagnosis.parseDiagnosisExtractionResponse("回答です"), []);
  assert.deepEqual(diagnosis.parseDiagnosisExtractionResponse("{}"), []);
  assert.deepEqual(
    diagnosis.parseDiagnosisExtractionResponse('{"extractions":[]}'),
    []
  );
});

test("明示値の矛盾はcontradictedとして保存する", () => {
  const state = explicit(diagnosis.createDiagnosisState(), { q1: "B" });
  diagnosis.applyDiagnosisExtractions(state, [{
    field: "q1", value: "C", state: "explicit", evidence: "二人で会っている"
  }]);
  assert.equal(state.answers.q1.state, "contradicted");
  assert.equal(state.answers.q1.value, null);
});

test("無効valueを持つexplicitはunknownへ修復する", () => {
  const state = diagnosis.ensureDiagnosisState({
    answers: { q1: { value: "Z", state: "explicit", evidence: "壊れた値" } }
  });
  assert.equal(state.answers.q1.state, "unknown");
  assert.equal(state.answers.q1.value, null);
});

test("数値・数値文字列の既存phaseは通常会話へ進める", () => {
  assert.equal(diagnosis.shouldUseDiagnosisFlow({ phase: 2 }), false);
  assert.equal(diagnosis.shouldUseDiagnosisFlow({ phase: "2" }), false);
  assert.equal(
    diagnosis.shouldUseDiagnosisFlow({ phase: 2, diagnosis: { status: "active" } }),
    false
  );
  assert.equal(
    diagnosis.shouldUseDiagnosisFlow({ phase: "2", diagnosis: { status: "active" } }),
    false
  );
  assert.equal(diagnosis.shouldUseDiagnosisFlow({ phase: "phase2" }), true);
});

test("phaseとactive diagnosisが共存しても通常Dify会話を使う", async () => {
  const kv = createKv({
    user: {
      phase: "2",
      difyConversationId: "existing-conversation",
      diagnosis: { status: "active" }
    }
  });
  let difyBody;
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ answer: "通常会話の返答" }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processMessage("相談です", "user", "reply", env);
  });

  assert.equal(difyBody.conversation_id, "existing-conversation");
  assert.match(difyBody.query, /安全ライン/);
  assert.deepEqual(replies, ["通常会話の返答"]);
});

test("同一intent内でも次の不足Qだけを選ぶ", () => {
  const safety = explicit(diagnosis.createDiagnosisState(), { q1: "B", q3: "B" });
  assert.equal(diagnosis.selectNextDiagnosisField(safety), "q4");

  const longTerm = explicit(diagnosis.createDiagnosisState(), { q1: "F", q11: "F" });
  assert.equal(diagnosis.selectNextDiagnosisField(longTerm), "q12");
});

test("Dify API失敗を記録し、2回目は固定選択肢へフォールバックする", async () => {
  const kv = createKv({ user: {} });
  const replies = [];
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        return new Response("upstream failed", { status: 500 });
      }
      replies.push(JSON.parse(options.body).messages[0].text);
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("最初の発話", "user", "reply-1", env, {});
      await diagnosis.processDiagnosisMessage("もう一度", "user", "reply-2", env, kv.read("user"));
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.extractionFailureCount, 2);
  assert.match(replies[0], /まず、今の状況/);
  assert.match(replies[1], /A: 特定の相手はいない/);
});

test("Difyの非JSON・空JSON・空extractionsも失敗回数へ加算する", async () => {
  for (const answer of ["回答文", "{}", '{"extractions":[]}']) {
    const kv = createKv({ user: {} });
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        return new Response(JSON.stringify({ answer }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("発話", "user", "reply", env, {});
    });
    assert.equal(kv.read("user").diagnosis.extractionFailureCount, 1);
  }
});

test("不正値またはinferredだけのDify抽出も固定質問へのフォールバック対象にする", async () => {
  for (const extraction of [
    { field: "q1", value: "Z", state: "explicit", evidence: "不正値" },
    { field: "q1", value: "B", state: "inferred", evidence: "文脈上そう見える" }
  ]) {
    const kv = createKv({ user: {} });
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [extraction] }) }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("発話", "user", "reply", env, {});
    });
    assert.equal(kv.read("user").diagnosis.extractionFailureCount, 1);
  }
});

test("Dify待機中に追加されたKVフィールドを保存後も保持する", async () => {
  const kv = createKv({
    user: { difyConversationId: "old-conversation", onboardingSentAt: "before" }
  });
  let difyQuery = "";

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyQuery = JSON.parse(options.body).query;
      const current = kv.read("user");
      kv.write("user", { ...current, precisionOfferSentAt: "during-dify", scheduledMarker: "keep" });
      return new Response(JSON.stringify({
        answer: JSON.stringify({ extractions: [{
          field: "q1", value: "B", state: "explicit", evidence: "気になる相手がいる"
        }] })
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("気になる人はいます", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.difyConversationId, "old-conversation");
  assert.equal(stored.onboardingSentAt, "before");
  assert.equal(stored.precisionOfferSentAt, "during-dify");
  assert.equal(stored.scheduledMarker, "keep");
  assert.equal(stored.diagnosis.answers.q1.value, "B");
  assert.match(difyQuery, /Q1 現在の状況/);
  assert.match(difyQuery, /Q12 現在または直近3年/);
});

test("固定Q1へのA回答はDifyを呼ばずWorkerがexplicitとして確定する", async () => {
  const state = diagnosis.createDiagnosisState();
  state.pendingField = "q1";
  state.pendingIntent = "current_relationship";
  state.extractionFailureCount = 2;
  state.pendingFieldFailureCount = 2;
  state.lastQuestionText = "Q1の固定質問";
  const kv = createKv({ user: { diagnosis: state } });
  let difyCalls = 0;

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      throw new Error("固定選択肢でDifyは呼ばれない");
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage(" Ａ ", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(difyCalls, 0);
  assert.equal(stored.diagnosis.answers.q1.value, "A");
  assert.equal(stored.diagnosis.answers.q1.state, "explicit");
  assert.equal(stored.diagnosis.extractionFailureCount, 0);
});

test("固定Q3へのF回答は無効としてWorkerが拒否し、explicitにしない", async () => {
  const state = explicit(diagnosis.createDiagnosisState(), { q1: "B" });
  state.pendingField = "q3";
  state.pendingIntent = "safety_context";
  state.lastQuestionText = "Q3の固定質問";
  const kv = createKv({ user: { diagnosis: state } });
  let difyCalls = 0;

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      return new Response(JSON.stringify({ answer: "{}" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("F", "user", "reply", env, kv.read("user"));
  });

  assert.equal(difyCalls, 0);
  assert.equal(kv.read("user").diagnosis.answers.q3.state, "unknown");
});

test("自由文抽出にはpendingField、正式設問、選択肢、直前質問を渡す", async () => {
  const state = explicit(diagnosis.createDiagnosisState(), { q6: "B" });
  state.pendingField = "q7";
  state.pendingIntent = "invitation_context";
  state.lastQuestionText = "直前のQ7質問文";
  const kv = createKv({ user: { diagnosis: state } });
  let difyQuery = "";

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyQuery = JSON.parse(options.body).query;
      return new Response(JSON.stringify({ answer: "{}" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("忙しいと言われました", "user", "reply", env, kv.read("user"));
  });

  assert.match(difyQuery, /今回確認中の項目:\nq7/);
  assert.match(difyQuery, /Q7 Q6がB〜Eの場合の誘いへの反応/);
  assert.match(difyQuery, /有効選択肢: A, B, C, D, E/);
  assert.match(difyQuery, /直前のQ7質問文/);
});

test("Difyが停止していても固定質問後のB回答で診断を前進できる", async () => {
  const kv = createKv({ user: {} });
  let difyCalls = 0;
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        difyCalls++;
        return new Response("unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("わからない", "user", "reply-1", env, {});
      await diagnosis.processDiagnosisMessage("わからない", "user", "reply-2", env, kv.read("user"));
      await diagnosis.processDiagnosisMessage("B", "user", "reply-3", env, kv.read("user"));
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = kv.read("user");
  assert.equal(difyCalls, 2);
  assert.equal(stored.diagnosis.answers.q1.value, "B");
  assert.equal(stored.diagnosis.pendingField, "q3");
  assert.equal(stored.diagnosis.extractionFailureCount, 0);
});

test("pendingField以外のexplicitではfailureCountをリセットしない", async () => {
  const state = diagnosis.createDiagnosisState();
  state.pendingField = "q1";
  state.pendingIntent = "current_relationship";
  state.extractionFailureCount = 2;
  state.pendingFieldFailureCount = 2;
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q12", value: "F", state: "explicit", evidence: "無関係な情報"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("答え", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.answers.q1.state, "unknown");
  assert.equal(stored.diagnosis.answers.q12.value, "F");
  assert.equal(stored.diagnosis.extractionFailureCount, 3);
});

test("pendingFieldが今回explicitになればfailureCountをリセットする", async () => {
  const state = diagnosis.createDiagnosisState();
  state.pendingField = "q1";
  state.pendingIntent = "current_relationship";
  state.extractionFailureCount = 2;
  state.pendingFieldFailureCount = 2;
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q1", value: "B", state: "explicit", evidence: "気になる相手がいる"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("相手はいる", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.answers.q1.value, "B");
  assert.equal(stored.diagnosis.extractionFailureCount, 0);
  assert.equal(stored.diagnosis.pendingFieldFailureCount, 0);
});

test("Dify待機中にphaseが確定したら古いdiagnosisを優先しない", async () => {
  const state = diagnosis.createDiagnosisState();
  state.pendingField = "q1";
  const kv = createKv({ user: { diagnosis: state } });
  let difyCalls = 0;
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      if (difyCalls === 1) {
        const latest = kv.read("user");
        latest.phase = "2";
        kv.write("user", latest);
        return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
          field: "q1", value: "B", state: "explicit", evidence: "古い抽出"
        }] }) }), { status: 200 });
      }
      return new Response(JSON.stringify({ answer: "通常Dify会話" }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("発話", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(difyCalls, 2);
  assert.equal(stored.phase, "2");
  assert.equal(stored.diagnosis.answers.q1.state, "unknown");
  assert.equal(diagnosis.shouldUseDiagnosisFlow(stored), false);
  assert.deepEqual(replies, ["通常Dify会話"]);
});

test("同じpendingFieldで解決不能が続けば一時停止し、後の直接選択で再開する", async () => {
  const state = diagnosis.createDiagnosisState();
  state.pendingField = "q1";
  state.pendingIntent = "current_relationship";
  state.extractionFailureCount = 2;
  state.pendingFieldFailureCount = 2;
  state.lastQuestionText = "Q1の固定質問";
  const kv = createKv({ user: { diagnosis: state } });
  let difyCalls = 0;
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      return new Response(JSON.stringify({ answer: "{}" }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("わからない", "user", "reply-1", env, kv.read("user"));
    await diagnosis.processDiagnosisMessage("どれかわからない", "user", "reply-2", env, kv.read("user"));
    await diagnosis.processDiagnosisMessage("A", "user", "reply-3", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(difyCalls, 1);
  assert.match(replies[0], /診断を一旦止めます/);
  assert.match(replies[1], /診断を一旦止めます/);
  assert.doesNotMatch(replies[0], /A: 特定の相手はいない/);
  assert.doesNotMatch(replies[1], /A: 特定の相手はいない/);
  assert.equal(stored.diagnosis.pausedField, null);
  assert.equal(stored.diagnosis.answers.q1.value, "A");
  assert.equal(stored.diagnosis.pendingField, "q10");
  assert.equal(stored.diagnosis.extractionFailureCount, 0);
});
