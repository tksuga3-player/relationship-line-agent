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
  diagnosisResultFallbackMessage,
  diagnosisResultMessage,
  parseDiagnosisResultContent,
  parseDiagnosisExtractionResponse,
  processMessage,
  processDiagnosisMessage,
  processFollowEvent,
  selectNextDiagnosisField,
  selectNextDiagnosisQuestion,
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

async function createLineSignature(body, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  return Buffer.from(signature).toString("base64");
}

async function sendWebhookEvents(events, env) {
  const body = JSON.stringify({ events });
  const signature = await createLineSignature(body, env.LINE_CHANNEL_SECRET);
  const pending = [];
  const response = await diagnosis.default.fetch(
    new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body
    }),
    env,
    { waitUntil(promise) { pending.push(promise); } }
  );
  await Promise.all(pending);
  return response;
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
  assert.equal(stored.diagnosis.pendingField, null);
  assert.equal(stored.diagnosis.pendingGroup, "safety_context");
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

function pendingGroupState(values, group) {
  const state = explicit(diagnosis.createDiagnosisState(), values);
  state.pendingGroup = group;
  state.pendingFields = [...({
    safety_context: ["q3", "q4", "q5"],
    invitation_context: ["q6", "q7"],
    post_date_romantic_context: ["q8", "q9"],
    long_term_stability: ["q11", "q12"]
  })[group]];
  state.pendingIntent = group;
  state.askedGroups = [group];
  state.lastQuestionText = "圧縮質問";
  return state;
}

test("Q3/Q4/Q5がすべてunknownならsafety圧縮質問を一度だけ送る", async () => {
  const state = explicit(diagnosis.createDiagnosisState(), { q1: "B" });
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: "{}" }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("補足です", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, "safety_context");
  assert.equal(stored.diagnosis.pendingField, null);
  assert.deepEqual(stored.diagnosis.pendingFields, ["q3", "q4", "q5"]);
  assert.match(replies[0], /最初の反応、そのあと会話がどう続いたか/);
});

test("safety圧縮回答でQ3/Q4/Q5がexplicitなら個別質問なしで判定へ進む", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
        { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
        { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
        { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
      ] }) }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("返事は固くてすぐ終わりますが、質問は普通にあります", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.phase, 2);
  assert.equal(stored.diagnosis.status, "complete");
  assert.equal(stored.diagnosis.pendingField, null);
  assert.match(replies[0], /安全ライン/);
});

test("safety圧縮回答がQ3/Q4だけならQ5だけを聞く", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
        { field: "q3", value: "C", state: "explicit", evidence: "普通に話せる" },
        { field: "q4", value: "C", state: "explicit", evidence: "自分が会話を回している" }
      ] }) }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("普通には話せますが、自分で会話を回しています", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, null);
  assert.equal(stored.diagnosis.pendingField, "q5");
  assert.match(replies[0], /質問やリアクション、話題提供/);
});

test("safety圧縮回答がQ3だけなら圧縮質問を再送せずQ4へ進む", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q3", value: "C", state: "explicit", evidence: "普通に話せる"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("普通には話せます", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, null);
  assert.equal(stored.diagnosis.pendingField, "q4");
  assert.equal(stored.diagnosis.askedGroups.includes("safety_context"), true);
});

test("invitation圧縮回答からQ6/Q7を同時にexplicitへ保存する", async () => {
  const state = pendingGroupState({ q1: "C", q10: "D" }, "invitation_context");
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
        { field: "q6", value: "E", state: "explicit", evidence: "実際に二人で会った" },
        { field: "q7", value: "D", state: "explicit", evidence: "相手から代案があった" }
      ] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("誘って会え、相手から別日も提案されました", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.answers.q6.value, "E");
  assert.equal(stored.diagnosis.answers.q7.value, "D");
  assert.equal(stored.diagnosis.pendingGroup, "post_date_romantic_context");
});

test("invitation圧縮回答でQ6=AならQ7をnot_applicableにする", async () => {
  const state = pendingGroupState({ q1: "C", q10: "D" }, "invitation_context");
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q6", value: "A", state: "explicit", evidence: "誘っていない"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("この3か月は誘っていません", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.answers.q6.value, "A");
  assert.equal(stored.diagnosis.answers.q7.state, "not_applicable");
});

test("post_date_romantic圧縮回答が部分的なら不足側だけを聞く", async () => {
  const state = pendingGroupState(
    { q1: "C", q10: "D", q6: "E", q7: "D" },
    "post_date_romantic_context"
  );
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q8", value: "D", state: "explicit", evidence: "二回目につながることもある"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("二回目につながることもあります", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, null);
  assert.equal(stored.diagnosis.pendingField, "q9");
});

test("long_term圧縮回答がQ11だけならQ12だけを聞く", async () => {
  const state = pendingGroupState({ q1: "F" }, "long_term_stability");
  const kv = createKv({ user: { diagnosis: state } });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q11", value: "F", state: "explicit", evidence: "安定して継続できた"
      }] }) }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("大きな問題なく続けられました", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, null);
  assert.equal(stored.diagnosis.pendingField, "q12");
});

test("圧縮質問の抽出失敗後は個別Qへ戻り、2回目の失敗で固定質問へフォールバックする", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        return new Response("unavailable", { status: 503 });
      }
      replies.push(JSON.parse(options.body).messages[0].text);
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("よくわかりません", "user", "reply-1", env, kv.read("user"));
      await diagnosis.processDiagnosisMessage("もう一度です", "user", "reply-2", env, kv.read("user"));
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = kv.read("user");
  assert.equal(stored.diagnosis.pendingGroup, null);
  assert.equal(stored.diagnosis.pendingField, "q3");
  assert.equal(stored.diagnosis.extractionFailureCount, 2);
  assert.match(replies[0], /最初の反応はどんなことが多い/);
  assert.match(replies[1], /A: 距離を取る・早く切る/);
});

test("完全新規followは最小KVと歓迎文だけを作成し、Difyを呼ばない", async () => {
  const kv = createKv();
  const replies = [];
  let difyCalls = 0;
  const env = {
    LINE_USERS: kv,
    LINE_CHANNEL_SECRET: "channel-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "token",
    DIFY_API_KEY: "test"
  };

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      throw new Error("follow must not call Dify");
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const response = await sendWebhookEvents([{
      type: "follow",
      source: { userId: "new-user" },
      replyToken: "follow-reply"
    }], env);
    assert.equal(response.status, 200);
  });

  const stored = kv.read("new-user");
  assert.equal(difyCalls, 0);
  assert.equal(stored.lineUserId, "new-user");
  assert.ok(stored.linkedAt);
  assert.ok(stored.updatedAt);
  assert.equal("phase" in stored, false);
  assert.equal("diagnosis" in stored, false);
  assert.equal("difyConversationId" in stored, false);
  assert.deepEqual(replies, [
    "友だち追加ありがとうございます。\n\n" +
      "「無料：恋愛ボトルネック診断＋あなたの次の一手」\n" +
      "をここから始められます。\n\n" +
      "いくつか会話するだけで、\n" +
      "今どこで詰まっているかと、\n" +
      "次に何を直すべきかを見ます。\n\n" +
      "特定の相手がいるなら今どんな関係か、\n" +
      "いないなら最近の女性とのやり取りを、\n" +
      "そのまま話してください。"
  ]);
});

test("follow後の最初のテキストは既存の診断v1.1へ進む", async () => {
  const kv = createKv();
  const env = {
    LINE_USERS: kv,
    LINE_CHANNEL_SECRET: "channel-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "token",
    DIFY_API_KEY: "test"
  };
  let difyCalls = 0;
  const replies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [{
        field: "q1", value: "B", state: "explicit", evidence: "気になる人はいるが二人では会っていない"
      }] }) }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    await sendWebhookEvents([{
      type: "follow",
      source: { userId: "new-user" },
      replyToken: "follow-reply"
    }], env);
    await diagnosis.processMessage("気になる人はいます", "new-user", "text-reply", env);
  });

  const stored = kv.read("new-user");
  assert.equal(difyCalls, 1);
  assert.equal(stored.phase, undefined);
  assert.equal(stored.diagnosis.status, "active");
  assert.equal(stored.diagnosis.answers.q1.value, "B");
  assert.equal(stored.diagnosis.pendingGroup, "safety_context");
  assert.match(replies[1], /最初の反応、そのあと会話がどう続いたか/);
});

test("既存ユーザーのfollowと再送は既存状態を破壊しない", async () => {
  const activeDiagnosis = explicit(diagnosis.createDiagnosisState(), { q1: "B" });
  const existing = {
    lineUserId: "existing-user",
    linkedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    phase: "2",
    difyConversationId: "conversation-1",
    diagnosis: activeDiagnosis,
    onboardingSentAt: "onboarding",
    step1SentAt: "step1",
    step2SentAt: "step2",
    precisionOfferSentAt: "offer",
    phaseProgress: { progress: "keep" },
    diagnosisSource: "tally",
    chatHandoffId: "handoff"
  };
  const kv = createKv({ "existing-user": existing });
  const welcomeReplies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      throw new Error("follow must not call Dify");
    }
    welcomeReplies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, LINE_CHANNEL_ACCESS_TOKEN: "token", DIFY_API_KEY: "test" };
    await diagnosis.processFollowEvent("existing-user", "follow-1", env);
    await diagnosis.processFollowEvent("existing-user", "follow-2", env);
  });

  assert.deepEqual(kv.read("existing-user"), existing);
  assert.equal(welcomeReplies.length, 2);
});

test("phase未確定のactive diagnosisユーザーもfollowで診断状態を保持する", async () => {
  const activeDiagnosis = explicit(diagnosis.createDiagnosisState(), { q1: "B", q3: "C" });
  activeDiagnosis.pendingField = "q4";
  const existing = {
    lineUserId: "active-user",
    linkedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    diagnosis: activeDiagnosis,
    difyConversationId: "must-remain"
  };
  const kv = createKv({ "active-user": existing });

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      throw new Error("follow must not call Dify");
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, LINE_CHANNEL_ACCESS_TOKEN: "token", DIFY_API_KEY: "test" };
    await diagnosis.processFollowEvent("active-user", "follow", env);
  });

  assert.deepEqual(kv.read("active-user"), existing);
  assert.equal(diagnosis.shouldUseDiagnosisFlow(kv.read("active-user")), true);
});

test("診断完了時は確定phaseをWorkerで固定し、根拠と次の一手を表示する", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];
  let resultPrompt = "";
  let difyCalls = 0;

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      const query = JSON.parse(options.body).query;
      if (difyCalls === 1) {
        return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
          { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
          { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
          { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
        ] }) }), { status: 200 });
      }
      resultPrompt = query;
      return new Response(JSON.stringify({ answer: JSON.stringify({
        reason: "返事はあるものの、会話が早く途切れるという回答がありました。",
        nextStep: "まずは相手が返しやすい話題を一つ置き、反応を待つことを優先してください。"
      }) }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("返事は固くてすぐ終わりますが、質問は普通にあります", "user", "reply", env, kv.read("user"));
  });

  const stored = kv.read("user");
  assert.equal(stored.phase, 2);
  assert.equal(stored.diagnosis.status, "complete");
  assert.match(replies[0], /【今のボトルネック】\n安全ライン/);
  assert.match(replies[0], /【なぜそう判定したか】/);
  assert.match(replies[0], /【あなたの次の一手】/);
  assert.match(resultPrompt, /Workerが確定したphase:\n2 \(安全ライン\)/);
  assert.match(resultPrompt, /返事はあるが固い/);
});

test("診断結果生成LLMの失敗時もphaseを保存し、固定フォールバックを返す", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];
  let difyCalls = 0;
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        difyCalls++;
        if (difyCalls === 1) {
          return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
            { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
            { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
            { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
          ] }) }), { status: 200 });
        }
        return new Response("unavailable", { status: 503 });
      }
      replies.push(JSON.parse(options.body).messages[0].text);
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processDiagnosisMessage("返事は固くてすぐ終わりますが、質問は普通にあります", "user", "reply", env, kv.read("user"));
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = kv.read("user");
  assert.equal(stored.phase, 2);
  assert.equal(stored.diagnosis.status, "complete");
  assert.match(replies[0], /【今のボトルネック】\n安全ライン/);
  assert.match(replies[0], /まずはこのラインを越えることを優先しましょう/);
});

test("LLMが異なるphaseを含めても、保存・表示するphaseはWorker確定値を維持する", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  const replies = [];
  let difyCalls = 0;

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      difyCalls++;
      if (difyCalls === 1) {
        return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
          { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
          { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
          { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
        ] }) }), { status: 200 });
      }
      return new Response(JSON.stringify({ answer: JSON.stringify({
        phase: 0,
        reason: "回答に基づく説明です。",
        nextStep: "一つだけ取り組んでください。"
      }) }), { status: 200 });
    }
    replies.push(JSON.parse(options.body).messages[0].text);
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("返事は固くてすぐ終わりますが、質問は普通にあります", "user", "reply", env, kv.read("user"));
  });

  assert.equal(kv.read("user").phase, 2);
  assert.match(replies[0], /【今のボトルネック】\n安全ライン/);
  assert.doesNotMatch(replies[0], /接触導線不足/);
});

test("scheduledハンドラは従来どおりfollow・診断Difyを呼ばず完了する", async () => {
  let scheduledWork;
  const env = {
    LINE_USERS: {
      async list() {
        return { keys: [], list_complete: true };
      }
    },
    LINE_CHANNEL_ACCESS_TOKEN: "test"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("空のscheduled処理は外部通信しない");
  };

  try {
    await diagnosis.default.scheduled({}, env, {
      waitUntil(promise) {
        scheduledWork = promise;
      }
    });
    await scheduledWork;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("診断結果生成Difyは通常会話のconversation_idを使用・上書きしない", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({
    user: { diagnosis: state, difyConversationId: "normal-conversation" }
  });
  const difyBodies = [];

  await withFetch(async (url, options) => {
    if (String(url).includes("api.dify.ai")) {
      const body = JSON.parse(options.body);
      difyBodies.push(body);
      if (difyBodies.length === 1) {
        return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
          { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
          { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
          { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
        ] }) }), { status: 200 });
      }
      if (difyBodies.length === 2) {
        return new Response(JSON.stringify({
          answer: JSON.stringify({ reason: "根拠です。", nextStep: "次の一手です。" }),
          conversation_id: "result-only-conversation"
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        answer: "通常伴走AIの返答",
        conversation_id: "normal-conversation"
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processDiagnosisMessage("診断回答", "user", "reply-1", env, kv.read("user"));
    assert.equal(kv.read("user").difyConversationId, "normal-conversation");
    await diagnosis.processMessage("次の相談です", "user", "reply-2", env);
  });

  assert.equal("conversation_id" in difyBodies[0], false);
  assert.equal("conversation_id" in difyBodies[1], false);
  assert.equal(difyBodies[2].conversation_id, "normal-conversation");
  assert.doesNotMatch(difyBodies[2].query, /文章作成者|explicit answers/);
  assert.equal(kv.read("user").difyConversationId, "normal-conversation");
});

test("結果生成の空・壊れたJSONは拒否し、長文でも次の一手をLINE上限内に残す", () => {
  assert.equal(diagnosis.parseDiagnosisResultContent(""), null);
  assert.equal(diagnosis.parseDiagnosisResultContent("not-json"), null);
  assert.equal(diagnosis.parseDiagnosisResultContent('{"reason":'), null);

  const fenced = diagnosis.parseDiagnosisResultContent(
    '説明です\n```json\n{"reason":"根拠","nextStep":"一手"}\n```'
  );
  assert.deepEqual(fenced, { reason: "根拠", nextStep: "一手" });

  const longContent = diagnosis.parseDiagnosisResultContent(JSON.stringify({
    reason: "理".repeat(6000),
    nextStep: "手".repeat(6000)
  }));
  assert.equal(longContent.reason.length, 1200);
  assert.equal(longContent.nextStep.length, 1200);
  const message = diagnosis.diagnosisResultMessage(2, longContent);
  assert.ok(message.length < 5000);
  assert.match(message, /【あなたの次の一手】/);
  assert.ok(message.indexOf("【あなたの次の一手】") < message.length - 1200);
});

test("Phase 5はボトルネックと表示せず、専用の完了表現を使う", () => {
  const generated = diagnosis.diagnosisResultMessage(5, {
    reason: "4つの判定ラインを通過した回答でした。",
    nextStep: "現在の関係を安定させるテーマを整理してください。"
  });
  const fallback = diagnosis.diagnosisResultFallbackMessage(5);

  for (const message of [generated, fallback]) {
    assert.match(message, /【診断結果】\n長期伴侶ラインを通過/);
    assert.doesNotMatch(message, /今のボトルネック/);
  }
});

test("診断結果のLINE Replyが失敗してもPhaseは保持される", async () => {
  const state = pendingGroupState({ q1: "B" }, "safety_context");
  const kv = createKv({ user: { diagnosis: state } });
  let difyCalls = 0;
  let fallbackPush = "";
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(async (url, options) => {
      if (String(url).includes("api.dify.ai")) {
        difyCalls++;
        if (difyCalls === 1) {
          return new Response(JSON.stringify({ answer: JSON.stringify({ extractions: [
            { field: "q3", value: "B", state: "explicit", evidence: "返事はあるが固い" },
            { field: "q4", value: "B", state: "explicit", evidence: "すぐ途切れる" },
            { field: "q5", value: "C", state: "explicit", evidence: "質問は普通にある" }
          ] }) }), { status: 200 });
        }
        return new Response(JSON.stringify({ answer: JSON.stringify({
          reason: "根拠です。", nextStep: "次の一手です。"
        }) }), { status: 200 });
      }
      if (String(url).includes("/message/reply")) {
        return new Response("expired", { status: 400 });
      }
      fallbackPush = JSON.parse(options.body).messages[0].text;
      return new Response("{}", { status: 200 });
    }, async () => {
      const env = { LINE_USERS: kv, DIFY_API_KEY: "test", LINE_CHANNEL_ACCESS_TOKEN: "test" };
      await diagnosis.processMessage("診断回答", "user", "reply", env);
    });
  } finally {
    console.error = originalConsoleError;
  }

  const stored = kv.read("user");
  assert.equal(stored.phase, 2);
  assert.equal(stored.diagnosis.status, "complete");
  assert.match(fallbackPush, /【今のボトルネック】\n安全ライン/);
  assert.match(fallbackPush, /【あなたの次の一手】/);
});

test("followでupdatedAtを更新してもscheduledはonboardingSentAtを基準にする", async () => {
  const onboardingSentAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const kv = createKv({
    user: { phase: 2, onboardingSentAt, marker: "keep" }
  });
  kv.list = async () => ({ keys: [{ name: "user" }], list_complete: true });
  const pushed = [];
  let scheduledWork;

  await withFetch(async (url, options) => {
    const body = JSON.parse(options.body);
    if (String(url).includes("/message/push")) {
      pushed.push(body.messages[0].text);
    }
    return new Response("{}", { status: 200 });
  }, async () => {
    const env = { LINE_USERS: kv, LINE_CHANNEL_ACCESS_TOKEN: "test" };
    await diagnosis.processFollowEvent("user", "follow-reply", env);
    const afterFollow = kv.read("user");
    assert.ok(afterFollow.linkedAt);
    assert.ok(afterFollow.updatedAt);
    assert.equal(afterFollow.onboardingSentAt, onboardingSentAt);
    assert.equal(afterFollow.marker, "keep");

    await diagnosis.default.scheduled({}, env, {
      waitUntil(promise) {
        scheduledWork = promise;
      }
    });
    await scheduledWork;
  });

  const stored = kv.read("user");
  assert.ok(stored.step1SentAt);
  assert.equal(pushed.length, 1);
});
