const encoder = new TextEncoder();

const DIAGNOSIS_VERSION = "tally-v3.1-line-v1";

const DIAGNOSIS_Q_CATALOG = {
  q1: ["A", "B", "C", "D", "E", "F"],
  q2: ["A", "B", "C", "D", "E"],
  q3: ["A", "B", "C", "D", "E"],
  q4: ["A", "B", "C", "D", "E"],
  q5: ["A", "B", "C", "D", "E"],
  q6: ["A", "B", "C", "D", "E"],
  q7: ["A", "B", "C", "D", "E"],
  q8: ["A", "B", "C", "D", "E"],
  q9: ["A", "B", "C", "D", "E"],
  q10: ["A", "B", "C", "D", "E"],
  q11: ["A", "B", "C", "D", "E", "F"],
  q12: ["A", "B", "C", "D", "E", "F"]
};

const DIAGNOSIS_EXTRACTION_CATALOG = `
Q1 現在の状況: A 特定の相手はいない / B 気になる相手はいるが二人で会う関係ではない / C 二人で会っているが恋愛・性的関係ではない / D 恋愛・性的関係にあるが正式交際ではない / E 交際中・1年未満 / F 交際中・1年以上
Q2 直近30日の恋愛対象になりうる女性との意味あるやり取り: A 0人 / B 1〜2人 / C 3〜5人 / D 6〜10人 / E 11人以上
Q3 最初の反応: A 目を合わせない・距離を取る・早く切る / B 返事はあるが固くすぐ終わる / C 普通に話せるが盛り上がりにくい / D 雑談が続き質問返しもある / E 相手から話題・近さなど好意的反応
Q4 会話の状態: A 会話が始まらない / B 始まるが短く途切れる / C 続くがこちらが回している / D 自然に雑談でき相手からも話題が出る / E 冗談・恋愛話・休日話も自然
Q5 質問・リアクション・話題提供: A ほぼない / B たまにあるが薄い / C 普通にはある / D けっこうある / E 相手から続けようとする
Q6 直近90日の誘い: A 誘っていない / B 誘ったが断られた / C 誘ったが曖昧に流れた / D 予定調整まで進んだ / E 実際に二人で会った
Q7 Q6がB〜Eの場合の誘いへの反応: A 無視・返信が極端に弱い / B 忙しい・また機会があれば等で流れる / C 嫌がられてはいないが具体日程にならない / D 代案・調整意思あり / E 前向きで二人で会う流れになる
Q8 二人で会った後: A 二人で会えていない / B 会った後返信が弱くなる・切れる / C 楽しく話せたが次につながらない / D 2回目以降につながることもある / E 複数回会う・恋愛関係へ進むことがある
Q9 男として見られている反応: A ほぼない / B たまにあるが自信なし / C 好意的だが恋愛感は薄い / D ある程度ある / E 明確にある
Q10 直近3年の最高到達点: A 二人で会えていない / B 一度二人で会った / C 複数回二人で会った / D 恋愛・性的関係まで進んだ / E 交際まで進んだ
Q11 直近3年で最も多い停止・崩壊地点: A 二人で会うところまで進まない / B 1回会った後に終わる / C 数回会うが恋愛関係へ進まない / D 恋愛・性的関係にはなるが交際へ進まない / E 交際するが信頼・安定・継続で崩れる / F 交際後も重大問題を繰り返さず安定継続
Q12 現在または直近3年で安定継続できた最長交際期間: A 安定した交際経験なし / B 1か月未満 / C 1〜3か月未満 / D 3〜6か月未満 / E 6か月〜1年未満 / F 1年以上
`;

const DIAGNOSIS_FIELD_INTENTS = {
  q1: "current_relationship",
  q2: "recent_contact_volume",
  q3: "safety_context",
  q4: "safety_context",
  q5: "safety_context",
  q6: "invitation_context",
  q7: "invitation_context",
  q8: "post_date_context",
  q9: "romantic_context",
  q10: "historical_progress",
  q11: "long_term_stability",
  q12: "long_term_stability"
};

const DIAGNOSIS_FIELD_QUESTIONS = {
  q1: "今の状況に一番近いものを、A〜Fで1つ選んでください。\nA: 特定の相手はいない\nB: 気になる相手はいるが二人では会っていない\nC: 二人で会っているが恋愛・性的関係ではない\nD: 恋愛・性的関係だが正式交際ではない\nE: 交際中・1年未満\nF: 交際中・1年以上",
  q2: "直近30日で、恋愛対象になりうる女性との意味あるやり取りは何人でしたか？\nA: 0人 / B: 1〜2人 / C: 3〜5人 / D: 6〜10人 / E: 11人以上",
  q3: "女性と接したときの最初の反応に一番近いものを選んでください。\nA: 距離を取る・早く切る\nB: 固くすぐ終わる\nC: 普通に話せるが盛り上がりにくい\nD: 雑談と質問返しがある\nE: 好意的な反応がある",
  q4: "女性との会話の状態に一番近いものを選んでください。\nA: 始まらない / B: 短く途切れる / C: こちらが回している / D: 自然な雑談と話題提供がある / E: 恋愛話なども自然",
  q5: "女性からの質問・リアクション・話題提供はどの程度ありますか？\nA: ほぼない / B: たまにあるが薄い / C: 普通にはある / D: けっこうある / E: 相手から続けようとする",
  q6: "直近90日で、女性を二人で食事やカフェなどに誘ったことはありますか？\nA: 誘っていない / B: 断られた / C: 曖昧に流れた / D: 予定調整まで進んだ / E: 実際に二人で会った",
  q7: "誘ったときの相手の反応に一番近いものを選んでください。\nA: 無視・返信が極端に弱い / B: 忙しい等で流れる / C: 具体日程にならない / D: 代案・調整意思あり / E: 前向きで会う流れになる",
  q8: "二人で会った後は次につながりますか？\nA: 二人で会えていない / B: 返信が弱くなる・切れる / C: 次につながらない / D: 2回目以降につながることもある / E: 複数回会う・恋愛関係へ進むことがある",
  q9: "女性から男として見られていると感じる反応はありますか？\nA: ほぼない / B: たまにあるが自信なし / C: 好意的だが恋愛感は薄い / D: ある程度ある / E: 明確にある",
  q10: "直近3年では、関係はどこまで進んだ経験がありますか？\nA: 二人で会えていない / B: 一度会った / C: 複数回会った / D: 恋愛・性的関係 / E: 交際",
  q11: "直近3年で、関係が最も多く止まる・崩れる地点を選んでください。\nA: 二人で会う前 / B: 1回会った後 / C: 数回会うが恋愛前 / D: 恋愛・性的関係から交際前 / E: 交際後に安定せず / F: 安定継続できた",
  q12: "現在または直近3年で、安定して続いた最長の交際期間を選んでください。\nA: なし / B: 1か月未満 / C: 1〜3か月未満 / D: 3〜6か月未満 / E: 6か月〜1年未満 / F: 1年以上"
};

const DIAGNOSIS_FIELD_PROMPTS = {
  q1: "まず、今の状況を教えてください。特定の相手がいるか、二人で会っているか、交際中かが分かると助かります。",
  q2: "直近30日で、恋愛対象になりうる女性と意味のあるやり取りをした人数は、どのくらいですか？",
  q3: "女性と接したとき、最初の反応はどんなことが多いですか？",
  q4: "女性との会話は、始まり方や続き方がどんな感じになることが多いですか？",
  q5: "女性から質問やリアクション、話題提供が返ってくることはどの程度ありますか？",
  q6: "直近90日で、女性を二人で食事やカフェなどに誘ったことはありますか？",
  q7: "その誘いに対して、相手はどんな反応をすることが多いですか？",
  q8: "二人で会えた場合、その後は次に会う流れへつながることが多いですか？",
  q9: "女性から男として見られていると感じる反応はありますか？",
  q10: "直近3年で、関係が最も進んだ経験はどこまでですか？",
  q11: "直近3年では、関係がどの地点で止まったり崩れたりすることが最も多いですか？",
  q12: "現在または直近3年で、安定して続いた最長の交際期間はどのくらいですか？"
};

// 圧縮質問は、対象Qがすべてunknownの最初の一度だけ使う。
// 回答で一部でも埋まった場合は、以後は既存のQ単位質問へ戻す。
const QUESTION_GROUPS = {
  safety_context: {
    fields: ["q3", "q4", "q5"],
    question:
      "最近、恋愛対象になりそうな女性と話した場面を一つ思い出してみてください。最初の反応、そのあと会話がどう続いたか、相手から質問や話題が返ってきたかを覚えている範囲で教えてください。"
  },
  invitation_context: {
    fields: ["q6", "q7"],
    question:
      "ここ3か月くらいで、女性を二人で食事やカフェに誘った場面があれば、そのとき相手がどう返して、その後どうなったか教えてください。なければ、誘っていないことだけで大丈夫です。"
  },
  post_date_romantic_context: {
    fields: ["q8", "q9"],
    question:
      "二人で会えたことがあるなら、その後また会う流れになったか、相手から異性としての好意を感じる反応があったかを、そのまま教えてください。"
  },
  long_term_stability: {
    fields: ["q11", "q12"],
    question:
      "ここ3年くらいの恋愛を振り返ると、関係はどの段階で止まりやすく、いちばん安定して続いた交際はどれくらいでしたか？"
  }
};

const DIAGNOSIS_ANSWER_STATES = new Set([
  "explicit",
  "inferred",
  "unknown",
  "contradicted",
  "not_applicable"
]);

const DIAGNOSIS_INTENTS = {
  current_relationship:
    "今、特定の相手はいますか？ いる場合は、二人で会う関係か、交際中かも教えてください。",
  recent_contact_volume:
    "直近30日で、恋愛対象になりそうな女性と意味のあるやり取りは何人くらいありましたか？",
  safety_context:
    "女性と接したとき、最初の反応や会話の続き方はどんなことが多いですか？ 相手から質問や話題が返ってくるかも教えてください。",
  invitation_context:
    "直近90日で、女性を二人で食事やカフェなどに誘ったことはありますか？ 誘った場合、相手はどんな反応でしたか？",
  post_date_context:
    "女性と二人で会った後は、その後のやり取りや次に会う流れはどうなりやすいですか？",
  romantic_context:
    "女性から、異性として見られていると感じる反応はどのくらいありますか？",
  historical_progress:
    "直近3年では、関係はどこまで進んだ経験がありますか？ 二人で会う、恋愛・性的関係、交際のどこまでか教えてください。",
  long_term_stability:
    "現在または直近3年で、安定して続いた関係はありますか？ どの地点で止まりやすいか、最長でどのくらい続いたかを教えてください。"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("LINE + Dify bot is running.");
    }

    // 内部呼び出し専用：初回メッセージ送信
if (request.method === "POST" && url.pathname === "/onboarding") {
  try {
    const body = await request.json();

    const userId = String(body.userId || "").trim();
    const phase = Number(body.phase);

    if (!userId || Number.isNaN(phase)) {
      return new Response("Bad Request", { status: 400 });
    }

    const phaseMessages = {
      0:
        "診断結果を確認しました。\n" +
        "今は、まず出会いの母数を作るところが次のポイントです。\n" +
        "最近30日で、恋愛対象になり得る女性と自然に話す機会は何回くらいありましたか？",

      1:
        "診断結果を確認しました。\n" +
        "今は「拒絶ライン」が次のポイントです。\n" +
        "最近の接点で、相手が早めに会話を終わらせようとしたり、距離を取る反応はありましたか？",

      2:
        "診断結果を確認しました。\n" +
        "今は「安全ライン」が次のポイントです。\n" +
        "まず最近の会話について1つ教えてください。\n" +
        "相手から質問や話題が返ってくることはありましたか？",

      3:
        "診断結果を確認しました。\n" +
        "今は「候補ライン」が次のポイントです。\n" +
        "普通に話せるところまでは来ています。\n" +
        "最近、恋愛方向に進めようとした場面で何が起きましたか？",

      4:
        "診断結果を確認しました。\n" +
        "今は「長期伴侶ライン」が次のポイントです。\n" +
        "関係が始まった後、どのあたりから不安定になりやすいですか？",

      5:
        "診断結果を確認しました。\n" +
        "4つのラインを一通り越えた実績があります。\n" +
        "今いちばん整理したいのは、出会い・関係の進展・長期安定のどれですか？"
    };

    const text =
      phaseMessages[phase] ||
      "診断結果を確認しました。\n今の状況について教えてください。";

    await pushMessage(
      userId,
      text,
      env.LINE_CHANNEL_ACCESS_TOKEN
    );

    return new Response("OK", { status: 200 });

  } catch (error) {
    console.error("Onboarding error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const body = await request.text();
      const lineSignature = request.headers.get("x-line-signature");

      if (!lineSignature) {
        return new Response("Missing signature", { status: 401 });
      }

      const valid = await verifyLineSignature(
        body,
        lineSignature,
        env.LINE_CHANNEL_SECRET
      );

      if (!valid) {
        return new Response("Invalid signature", { status: 401 });
      }

      const data = JSON.parse(body);

      if (!Array.isArray(data.events) || data.events.length === 0) {
        return new Response("OK", { status: 200 });
      }

      for (const event of data.events) {
        if (
          event.type === "message" &&
          event.message?.type === "text"
        ) {
          const userText = event.message.text;
          const userId = event.source?.userId;
          const replyToken = event.replyToken;

          if (!userId || !replyToken) continue;

          ctx.waitUntil(
            processMessage(
              userText,
              userId,
              replyToken,
              env
            )
          );
        }
      }

      // LINEには即200を返す
      return new Response("OK", { status: 200 });

    } catch (error) {
      console.error("Webhook error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

    async scheduled(controller, env, ctx) {
    ctx.waitUntil(runFollowupPreview(env));
  }
};

function createDiagnosisAnswer() {
  return {
    value: null,
    state: "unknown",
    evidence: ""
  };
}

function createDiagnosisState(now = new Date().toISOString()) {
  const answers = {};

  for (const field of Object.keys(DIAGNOSIS_Q_CATALOG)) {
    answers[field] = createDiagnosisAnswer();
  }

  return {
    version: DIAGNOSIS_VERSION,
    status: "active",
    answers,
    q7Applicability: "unknown",
    askedIntents: [],
    askedGroups: [],
    pendingIntent: null,
    pendingField: null,
    pendingGroup: null,
    pendingFields: [],
    pendingFieldFailureCount: 0,
    pausedField: null,
    lastQuestionText: "",
    extractionFailureCount: 0,
    phase: null,
    safetyScore: null,
    candidateScore: null,
    startedAt: now,
    updatedAt: now
  };
}

function ensureDiagnosisState(existing, now = new Date().toISOString()) {
  const diagnosis = existing && typeof existing === "object"
    ? existing
    : createDiagnosisState(now);

  diagnosis.version = DIAGNOSIS_VERSION;
  diagnosis.status = diagnosis.status === "complete" ? "complete" : "active";
  diagnosis.answers = diagnosis.answers && typeof diagnosis.answers === "object"
    ? diagnosis.answers
    : {};
  diagnosis.askedIntents = Array.isArray(diagnosis.askedIntents)
    ? diagnosis.askedIntents
    : [];
  diagnosis.askedGroups = Array.isArray(diagnosis.askedGroups)
    ? diagnosis.askedGroups.filter((group) => Object.hasOwn(QUESTION_GROUPS, group))
    : [];

  for (const field of Object.keys(DIAGNOSIS_Q_CATALOG)) {
    const answer = diagnosis.answers[field];

    if (!answer || typeof answer !== "object") {
      diagnosis.answers[field] = createDiagnosisAnswer();
      continue;
    }

    const hasValidValue = DIAGNOSIS_Q_CATALOG[field].includes(answer.value);
    let state = DIAGNOSIS_ANSWER_STATES.has(answer.state)
      ? answer.state
      : "unknown";

    if (
      (["explicit", "inferred"].includes(state) && !hasValidValue) ||
      (state === "not_applicable" && field !== "q7")
    ) {
      state = "unknown";
    }

    diagnosis.answers[field] = {
      value: hasValidValue ? answer.value : null,
      state,
      evidence: typeof answer.evidence === "string"
        ? answer.evidence.slice(0, 500)
        : ""
    };
  }

  diagnosis.q7Applicability = ["unknown", "required", "not_applicable"].includes(
    diagnosis.q7Applicability
  )
    ? diagnosis.q7Applicability
    : "unknown";
  diagnosis.pendingIntent = (
    Object.hasOwn(DIAGNOSIS_INTENTS, diagnosis.pendingIntent) ||
    Object.hasOwn(QUESTION_GROUPS, diagnosis.pendingIntent)
  )
    ? diagnosis.pendingIntent
    : null;
  diagnosis.pendingField = Object.hasOwn(DIAGNOSIS_Q_CATALOG, diagnosis.pendingField)
    ? diagnosis.pendingField
    : null;
  diagnosis.pendingGroup = Object.hasOwn(QUESTION_GROUPS, diagnosis.pendingGroup)
    ? diagnosis.pendingGroup
    : null;
  diagnosis.pendingFields = Array.isArray(diagnosis.pendingFields)
    ? diagnosis.pendingFields.filter((field) => Object.hasOwn(DIAGNOSIS_Q_CATALOG, field))
    : [];
  diagnosis.pendingFieldFailureCount = Number.isInteger(
    diagnosis.pendingFieldFailureCount
  ) && diagnosis.pendingFieldFailureCount >= 0
    ? diagnosis.pendingFieldFailureCount
    : 0;
  diagnosis.pausedField = Object.hasOwn(DIAGNOSIS_Q_CATALOG, diagnosis.pausedField)
    ? diagnosis.pausedField
    : null;
  diagnosis.lastQuestionText = typeof diagnosis.lastQuestionText === "string"
    ? diagnosis.lastQuestionText.slice(0, 5000)
    : "";
  diagnosis.extractionFailureCount = Number.isInteger(
    diagnosis.extractionFailureCount
  ) && diagnosis.extractionFailureCount >= 0
    ? diagnosis.extractionFailureCount
    : 0;
  diagnosis.phase = Number.isInteger(diagnosis.phase)
    ? diagnosis.phase
    : null;
  diagnosis.safetyScore = Number.isInteger(diagnosis.safetyScore)
    ? diagnosis.safetyScore
    : null;
  diagnosis.candidateScore = Number.isInteger(diagnosis.candidateScore)
    ? diagnosis.candidateScore
    : null;
  diagnosis.startedAt = typeof diagnosis.startedAt === "string"
    ? diagnosis.startedAt
    : now;
  diagnosis.updatedAt = now;

  applyQ7Applicability(diagnosis);
  return diagnosis;
}

function normalizeDiagnosisExtraction(raw) {
  if (!raw || typeof raw !== "object") return null;

  const field = String(raw.field || "").trim().toLowerCase();
  if (!Object.hasOwn(DIAGNOSIS_Q_CATALOG, field)) return null;

  const state = String(raw.state || "").trim().toLowerCase();
  if (!DIAGNOSIS_ANSWER_STATES.has(state)) return null;

  const value = raw.value === null || raw.value === undefined
    ? null
    : String(raw.value).trim().toUpperCase();
  const evidence = typeof raw.evidence === "string"
    ? raw.evidence.trim().slice(0, 500)
    : "";

  if (state === "not_applicable") {
    return field === "q7"
      ? { field, value: null, state, evidence }
      : null;
  }

  if (["explicit", "inferred"].includes(state)) {
    if (!DIAGNOSIS_Q_CATALOG[field].includes(value) || !evidence) {
      return null;
    }
    return { field, value, state, evidence };
  }

  if (["unknown", "contradicted"].includes(state)) {
    return { field, value: null, state, evidence };
  }

  return null;
}

function applyQ7Applicability(diagnosis) {
  const q6 = diagnosis.answers.q6;

  if (q6.state === "explicit" && q6.value === "A") {
    diagnosis.q7Applicability = "not_applicable";
    diagnosis.answers.q7 = {
      value: null,
      state: "not_applicable",
      evidence: "Q6=Aのため対象外"
    };
    return;
  }

  if (q6.state === "explicit" && q6.value) {
    diagnosis.q7Applicability = "required";
    if (diagnosis.answers.q7.state === "not_applicable") {
      diagnosis.answers.q7 = createDiagnosisAnswer();
    }
    return;
  }

  diagnosis.q7Applicability = "unknown";
}

function applyDiagnosisExtractions(diagnosis, rawExtractions) {
  const extractions = Array.isArray(rawExtractions) ? rawExtractions : [];
  const appliedExplicitFields = [];
  const newlyNotApplicableFields = [];
  const previousQ7State = diagnosis.answers.q7.state;

  for (const raw of extractions) {
    const extraction = normalizeDiagnosisExtraction(raw);
    if (!extraction) continue;

    const current = diagnosis.answers[extraction.field];

    if (extraction.state === "explicit") {
      if (
        current.state === "explicit" &&
        current.value &&
        current.value !== extraction.value
      ) {
        diagnosis.answers[extraction.field] = {
          value: null,
          state: "contradicted",
          evidence: [current.evidence, extraction.evidence]
            .filter(Boolean)
            .join(" / ")
            .slice(0, 500)
        };
        continue;
      }

      diagnosis.answers[extraction.field] = extraction;
      if (current.state !== "explicit" || current.value !== extraction.value) {
        appliedExplicitFields.push(extraction.field);
      }
      continue;
    }

    if (extraction.state === "inferred") {
      if (current.state !== "explicit") {
        diagnosis.answers[extraction.field] = extraction;
      }
      continue;
    }

    if (extraction.state === "contradicted") {
      diagnosis.answers[extraction.field] = extraction;
    }
  }

  applyQ7Applicability(diagnosis);
  if (
    previousQ7State !== "not_applicable" &&
    diagnosis.answers.q7.state === "not_applicable"
  ) {
    newlyNotApplicableFields.push("q7");
  }
  return { appliedExplicitFields, newlyNotApplicableFields };
}

function getExplicitDiagnosisAnswers(diagnosis) {
  const explicitAnswers = {};

  for (const field of Object.keys(DIAGNOSIS_Q_CATALOG)) {
    const answer = diagnosis.answers[field];
    explicitAnswers[field] = answer.state === "explicit"
      ? answer.value
      : null;
  }

  return explicitAnswers;
}

function hasExplicitAnswers(diagnosis, fields) {
  return fields.every(
    (field) => diagnosis.answers[field]?.state === "explicit"
  );
}

function hasExplicitCandidateInputs(diagnosis) {
  if (!hasExplicitAnswers(diagnosis, ["q6", "q8", "q9"])) {
    return false;
  }

  return diagnosis.answers.q6.value === "A" ||
    diagnosis.answers.q7?.state === "explicit";
}

// Tally診断WorkerのcalculateScoresと同じ採点規則。
function calculateDiagnosisScores(a) {
  let safetyScore = 0;
  if (a.q3 === "B") safetyScore += 2;
  if (a.q3 === "C") safetyScore += 1;
  if (a.q4 === "B") safetyScore += 2;
  if (a.q4 === "C") safetyScore += 1;
  if (a.q5 === "A") safetyScore += 2;
  if (a.q5 === "B") safetyScore += 1;

  let candidateScore = 0;
  if (a.q6 === "E") candidateScore += 1;
  if (["D", "E"].includes(a.q7)) candidateScore += 1;
  if (a.q8 === "D") candidateScore += 1;
  if (a.q8 === "E") candidateScore += 2;
  if (a.q9 === "D") candidateScore += 1;
  if (a.q9 === "E") candidateScore += 2;

  return { safetyScore, candidateScore };
}

// Tally診断WorkerのdeterminePhaseと同じ条件・優先順位。
function determineDiagnosisPhase(a, scores) {
  const { safetyScore, candidateScore } = scores;

  if (a.q1 === "F" && a.q11 === "F" && a.q12 === "F") return 5;
  if (["E", "F"].includes(a.q1)) return 4;
  if (a.q1 === "D") return 4;

  if (
    ["A", "C"].includes(a.q1) &&
    candidateScore >= 3 &&
    ["D", "E"].includes(a.q10)
  ) return 4;

  if (a.q1 === "A" && ["A", "B"].includes(a.q2)) return 0;

  if (
    ["A", "B"].includes(a.q1) &&
    (a.q3 === "A" || a.q4 === "A")
  ) return 1;

  if (
    ["A", "B"].includes(a.q1) &&
    safetyScore >= 3
  ) return 2;

  return 3;
}

function getDiagnosisDecision(diagnosis) {
  const a = getExplicitDiagnosisAnswers(diagnosis);

  if (!a.q1) return null;

  if (["D", "E"].includes(a.q1)) {
    const scores = calculateDiagnosisScores(a);
    return { phase: determineDiagnosisPhase(a, scores), scores };
  }

  if (a.q1 === "F") {
    if (!hasExplicitAnswers(diagnosis, ["q11", "q12"])) return null;
    const scores = calculateDiagnosisScores(a);
    return { phase: determineDiagnosisPhase(a, scores), scores };
  }

  if (a.q1 === "C") {
    if (!a.q10) return null;
    if (["D", "E"].includes(a.q10) && !hasExplicitCandidateInputs(diagnosis)) {
      return null;
    }
    const scores = calculateDiagnosisScores(a);
    return { phase: determineDiagnosisPhase(a, scores), scores };
  }

  if (a.q1 === "B") {
    if (a.q3 === "A" || a.q4 === "A") {
      const scores = calculateDiagnosisScores(a);
      return { phase: determineDiagnosisPhase(a, scores), scores };
    }
    if (!hasExplicitAnswers(diagnosis, ["q3", "q4", "q5"])) return null;
    const scores = calculateDiagnosisScores(a);
    return { phase: determineDiagnosisPhase(a, scores), scores };
  }

  if (a.q1 === "A") {
    if (!a.q10) return null;

    if (["D", "E"].includes(a.q10)) {
      if (!hasExplicitCandidateInputs(diagnosis)) return null;
      const candidateScores = calculateDiagnosisScores(a);
      if (candidateScores.candidateScore >= 3) {
        return {
          phase: determineDiagnosisPhase(a, candidateScores),
          scores: candidateScores
        };
      }
    }

    if (!a.q2) return null;
    if (["A", "B"].includes(a.q2)) {
      const scores = calculateDiagnosisScores(a);
      return { phase: determineDiagnosisPhase(a, scores), scores };
    }
    if (a.q3 === "A" || a.q4 === "A") {
      const scores = calculateDiagnosisScores(a);
      return { phase: determineDiagnosisPhase(a, scores), scores };
    }
    if (!hasExplicitAnswers(diagnosis, ["q3", "q4", "q5"])) return null;
    const scores = calculateDiagnosisScores(a);
    return { phase: determineDiagnosisPhase(a, scores), scores };
  }

  return null;
}

function getNextCandidateField(diagnosis) {
  if (diagnosis.answers.q6.state !== "explicit") {
    return "q6";
  }
  if (
    diagnosis.answers.q6.value !== "A" &&
    diagnosis.answers.q7.state !== "explicit"
  ) {
    return "q7";
  }
  if (diagnosis.answers.q8.state !== "explicit") {
    return "q8";
  }
  if (diagnosis.answers.q9.state !== "explicit") {
    return "q9";
  }
  return null;
}

function selectNextDiagnosisField(diagnosis) {
  if (getDiagnosisDecision(diagnosis)) return null;

  const q1 = diagnosis.answers.q1;
  if (q1.state !== "explicit") return "q1";

  if (q1.value === "F") {
    if (diagnosis.answers.q11.state !== "explicit") return "q11";
    if (diagnosis.answers.q12.state !== "explicit") return "q12";
    return null;
  }
  if (["D", "E"].includes(q1.value)) return null;

  if (q1.value === "B") {
    if (diagnosis.answers.q3.state !== "explicit") return "q3";
    if (diagnosis.answers.q4.state !== "explicit") return "q4";
    if (diagnosis.answers.q5.state !== "explicit") return "q5";
    return null;
  }

  if (q1.value === "C") {
    if (diagnosis.answers.q10.state !== "explicit") {
      return "q10";
    }
    return getNextCandidateField(diagnosis);
  }

  if (q1.value === "A") {
    if (diagnosis.answers.q10.state !== "explicit") {
      return "q10";
    }
    if (["D", "E"].includes(diagnosis.answers.q10.value)) {
      const candidateField = getNextCandidateField(diagnosis);
      if (candidateField) return candidateField;
    }
    if (diagnosis.answers.q2.state !== "explicit") {
      return "q2";
    }
    if (diagnosis.answers.q3.state !== "explicit") return "q3";
    if (diagnosis.answers.q4.state !== "explicit") return "q4";
    if (diagnosis.answers.q5.state !== "explicit") return "q5";
    return null;
  }

  return "q1";
}

function selectNextDiagnosisIntent(diagnosis) {
  const field = selectNextDiagnosisField(diagnosis);
  return field ? DIAGNOSIS_FIELD_INTENTS[field] : null;
}

function questionGroupForField(diagnosis, field) {
  if (!field) return null;

  for (const [groupName, group] of Object.entries(QUESTION_GROUPS)) {
    if (
      group.fields[0] === field &&
      !diagnosis.askedGroups.includes(groupName) &&
      group.fields.every(
        (groupField) => diagnosis.answers[groupField]?.state === "unknown"
      )
    ) {
      return groupName;
    }
  }

  return null;
}

function selectNextDiagnosisQuestion(diagnosis) {
  const field = selectNextDiagnosisField(diagnosis);
  const group = questionGroupForField(diagnosis, field);

  return group
    ? { field: null, group }
    : { field, group: null };
}

function diagnosisQuestionForField(diagnosis, field) {
  if (!field || !Object.hasOwn(DIAGNOSIS_Q_CATALOG, field)) {
    return DIAGNOSIS_FIELD_PROMPTS.q1;
  }

  return diagnosis.extractionFailureCount >= 2
    ? DIAGNOSIS_FIELD_QUESTIONS[field]
    : DIAGNOSIS_FIELD_PROMPTS[field];
}

function diagnosisQuestionForSelection(diagnosis, selection) {
  if (selection.group) {
    return QUESTION_GROUPS[selection.group].question;
  }

  return diagnosisQuestionForField(diagnosis, selection.field);
}

function getDiagnosisCatalogEntry(field) {
  const questionNumber = String(field || "").replace(/^q/, "");
  return DIAGNOSIS_EXTRACTION_CATALOG
    .split("\n")
    .find((line) => line.startsWith(`Q${questionNumber} `)) || "";
}

function normalizeDirectDiagnosisChoice(userText, field) {
  if (!field || !Object.hasOwn(DIAGNOSIS_Q_CATALOG, field)) return null;

  const normalized = String(userText || "")
    .trim()
    .replace(/[Ａ-Ｆａ-ｆ]/g, (character) => {
      const code = character.charCodeAt(0);
      return String.fromCharCode(code >= 0xFF41 ? code - 0xFEE0 : code - 0xFEE0);
    })
    .toUpperCase();

  if (!/^[A-F]$/.test(normalized)) return null;
  if (!DIAGNOSIS_Q_CATALOG[field].includes(normalized)) {
    return { invalid: true };
  }

  return {
    extraction: {
      field,
      value: normalized,
      state: "explicit",
      evidence: "固定選択肢への直接回答"
    }
  };
}

function diagnosisPauseMessage(field) {
  const choices = DIAGNOSIS_Q_CATALOG[field]?.join("、") || "A〜F";
  return "この項目は今わからなくても大丈夫です。診断を一旦止めます。\n" +
    `後でQ${String(field).replace(/^q/, "")}に対して ${choices} のどれか1文字だけ送れば、ここから再開できます。`;
}

function parseDiagnosisExtractionResponse(answer) {
  const text = String(answer || "").trim();
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed?.extractions)
        ? parsed.extractions
        : [];
    } catch {
      // Difyの通常会話文など、JSON以外は安全に無視する。
    }
  }

  return [];
}

async function extractDiagnosisCandidates(userText, userId, apiKey, diagnosis) {
  const knownAnswers = Object.fromEntries(
    Object.entries(diagnosis.answers).map(([field, answer]) => [
      field,
      {
        value: answer.value,
        state: answer.state,
        evidence: answer.evidence
      }
    ])
  );

  const prompt =
    "あなたは恋愛診断の情報抽出器です。最終判定や会話文は出力しません。" +
    "以下の正式Qカタログだけを基準に、ユーザー発話からQ1〜Q12の候補へ変換してください。" +
    "明示的に該当すると判断できるものだけをstate=explicitにしてください。" +
    "曖昧な内容を無理にA〜Fへ割り当てず、その場合はextractionsに含めないかstate=inferredにしてください。" +
    "1回答に複数Qそれぞれの明示的根拠がある場合は、複数のextractionsを返して構いません。" +
    "圧縮質問に含まれているだけではexplicitにせず、各Qごとに独立した根拠が必要です。推測・補完は禁止です。" +
    "0件のextractionsでも構いません。各explicitには短いevidenceを必ず付けてください。" +
    "Q6=Aをexplicitにする場合、Q7は出力しないでください。" +
    "出力はJSONオブジェクトのみです。形式: " +
    '{"extractions":[{"field":"q1","value":"B","state":"explicit","evidence":"根拠"}]}' +
    "。推測はstate=inferred、分からない場合はextractionsに含めません。" +
    "\n\n正式Qカタログ:\n" +
    DIAGNOSIS_EXTRACTION_CATALOG +
    "\n\n既存状態:\n" +
    JSON.stringify(knownAnswers) +
    "\n\n今回確認中の項目:\n" +
    (diagnosis.pendingField
      ? `${diagnosis.pendingField}\n正式設問: ${getDiagnosisCatalogEntry(diagnosis.pendingField)}\n有効選択肢: ${DIAGNOSIS_Q_CATALOG[diagnosis.pendingField].join(", ")}`
      : "未指定") +
    "\n\n圧縮質問グループ:\n" +
    (diagnosis.pendingGroup
      ? JSON.stringify({
        questionGroup: diagnosis.pendingGroup,
        targetFields: QUESTION_GROUPS[diagnosis.pendingGroup].fields
      })
      : "なし") +
    "\n\n直前にBotが送った質問文:\n" +
    (diagnosis.lastQuestionText || "なし") +
    "\n\n今回のユーザー発話:\n" +
    userText;

  try {
    const result = await callDify(prompt, userId, apiKey, "");
    return parseDiagnosisExtractionResponse(result.answer);
  } catch (error) {
    console.error("Diagnosis extraction failed:", error);
    return [];
  }
}

function diagnosisPhaseMessage(phase) {
  const phaseNames = {
    0: "接触導線不足",
    1: "拒絶ライン",
    2: "安全ライン",
    3: "候補ライン",
    4: "長期伴侶ライン",
    5: "4つの判定ラインを通過"
  };

  return "診断に必要な情報がそろいました。\n" +
    `現在の判定は「${phaseNames[phase] || `フェーズ${phase}`}」です。`;
}

async function processDiagnosisMessage(userText, userId, replyToken, env, userData) {
  const now = new Date().toISOString();
  const diagnosisBeforeExtraction = ensureDiagnosisState(userData.diagnosis, now);
  const directChoice = normalizeDirectDiagnosisChoice(
    userText,
    diagnosisBeforeExtraction.pendingField
  );
  const directExtraction = directChoice?.extraction || null;
  const isInvalidDirectChoice = directChoice?.invalid === true;
  const isPausedAtPendingField =
    !directExtraction &&
    diagnosisBeforeExtraction.pausedField &&
    diagnosisBeforeExtraction.pausedField === diagnosisBeforeExtraction.pendingField;
  let extractions = [];

  if (directExtraction) {
    // 固定選択肢に対する一文字回答はDifyを経由しない。
    extractions = [directExtraction];
  } else if (!isPausedAtPendingField && !isInvalidDirectChoice) {
    extractions = await extractDiagnosisCandidates(
      userText,
      userId,
      env.DIFY_API_KEY,
      diagnosisBeforeExtraction
    );
  }

  // Dify待機中に他のWebhookが保存したフィールドを消さないよう、
  // 抽出後に最新のKV値へ今回の診断差分だけを適用する。
  const latestSaved = await env.LINE_USERS.get(userId);
  let latestUserData = {};
  if (latestSaved) {
    try {
      latestUserData = JSON.parse(latestSaved);
    } catch {
      // 既存のprocessMessageと同じく、壊れたKV値を引き継いで上書きしない。
      latestUserData = {};
    }
  }

  // 抽出待機中に別処理がphaseを確定した場合は、古いdiagnosisを
  // 保存し直さず、通常会話の経路へ引き渡す。
  if (getExistingPhase(latestUserData.phase) !== null) {
    await processMessage(userText, userId, replyToken, env);
    return;
  }

  const diagnosis = ensureDiagnosisState(
    latestUserData.diagnosis || diagnosisBeforeExtraction,
    now
  );
  if (
    !directExtraction &&
    diagnosis.pausedField &&
    diagnosis.pausedField === diagnosis.pendingField
  ) {
    await replyMessage(
      replyToken,
      diagnosisPauseMessage(diagnosis.pendingField),
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
    return;
  }

  const pendingFieldBeforeExtraction = diagnosis.pendingField;
  const pendingGroupBeforeExtraction = diagnosis.pendingGroup;
  const pendingFieldsBeforeExtraction = pendingGroupBeforeExtraction
    ? QUESTION_GROUPS[pendingGroupBeforeExtraction].fields
    : pendingFieldBeforeExtraction
      ? [pendingFieldBeforeExtraction]
      : [];
  const extractionResult = applyDiagnosisExtractions(diagnosis, extractions);
  const decision = getDiagnosisDecision(diagnosis);
  const pendingFieldAdvanced = pendingFieldsBeforeExtraction.length > 0
    ? pendingFieldsBeforeExtraction.some(
      (field) =>
        extractionResult.appliedExplicitFields.includes(field) ||
        extractionResult.newlyNotApplicableFields.includes(field)
    )
    : extractionResult.appliedExplicitFields.length > 0 ||
      extractionResult.newlyNotApplicableFields.length > 0;
  const diagnosisAdvanced = pendingFieldAdvanced || Boolean(decision);

  let replyText;

  if (decision) {
    diagnosis.status = "complete";
    diagnosis.phase = decision.phase;
    diagnosis.safetyScore = decision.scores.safetyScore;
    diagnosis.candidateScore = decision.scores.candidateScore;
    diagnosis.pendingIntent = null;
    diagnosis.pendingField = null;
    diagnosis.pendingGroup = null;
    diagnosis.pendingFields = [];
    diagnosis.pendingFieldFailureCount = 0;
    diagnosis.pausedField = null;
    diagnosis.lastQuestionText = "";
    diagnosis.extractionFailureCount = 0;
    latestUserData.phase = decision.phase;
    replyText = diagnosisPhaseMessage(decision.phase);
  } else {
    const selection = selectNextDiagnosisQuestion(diagnosis);
    const { field, group } = selection;
    const intent = group || (field ? DIAGNOSIS_FIELD_INTENTS[field] : null);
    const samePendingField = field && field === pendingFieldBeforeExtraction;

    if (diagnosisAdvanced) {
      diagnosis.extractionFailureCount = 0;
      diagnosis.pendingFieldFailureCount = 0;
      diagnosis.pausedField = null;
    } else {
      diagnosis.extractionFailureCount += 1;
      diagnosis.pendingFieldFailureCount = samePendingField
        ? diagnosis.pendingFieldFailureCount + 1
        : field
          ? 1
          : 0;
    }

    diagnosis.pendingIntent = intent;
    diagnosis.pendingField = field;
    diagnosis.pendingGroup = group;
    diagnosis.pendingFields = group
      ? [...QUESTION_GROUPS[group].fields]
      : field
        ? [field]
        : [];
    if (group && !diagnosis.askedGroups.includes(group)) {
      diagnosis.askedGroups.push(group);
    }
    if (intent && !diagnosis.askedIntents.includes(intent)) {
      diagnosis.askedIntents.push(intent);
    }

    if (field && diagnosis.pendingFieldFailureCount >= 3) {
      diagnosis.pausedField = field;
      replyText = diagnosisPauseMessage(field);
    } else {
      diagnosis.pausedField = null;
      replyText = diagnosisQuestionForSelection(diagnosis, selection);
      diagnosis.lastQuestionText = replyText;
    }
  }

  diagnosis.updatedAt = new Date().toISOString();
  latestUserData.diagnosis = diagnosis;
  latestUserData.updatedAt = diagnosis.updatedAt;

  await env.LINE_USERS.put(userId, JSON.stringify(latestUserData));
  await replyMessage(replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
}

function getExistingPhase(phase) {
  if (Number.isInteger(phase) && phase >= 0 && phase <= 5) return phase;
  if (typeof phase === "string" && /^[0-5]$/.test(phase.trim())) {
    return Number(phase.trim());
  }
  return null;
}

function shouldUseDiagnosisFlow(userData) {
  if (getExistingPhase(userData?.phase) !== null) return false;
  if (userData?.diagnosis?.status === "complete") return false;
  return true;
}

async function processMessage(userText, userId, replyToken, env) {
  try {
    const saved = await env.LINE_USERS.get(userId);
    const userData = saved ? JSON.parse(saved) : {};

    if (shouldUseDiagnosisFlow(userData)) {
      await processDiagnosisMessage(
        userText,
        userId,
        replyToken,
        env,
        userData
      );
      return;
    }

    let diagnosisContext = "";
    let conversationId = "";

    if (saved) {
      const phaseNames = {
        0: "接触導線",
        1: "拒絶ライン",
        2: "安全ライン",
        3: "候補ライン",
        4: "長期伴侶ライン",
        5: "4フェーズ通過"
      };

      const phaseName =
        phaseNames[userData.phase] ||
        `フェーズ${userData.phase}`;

      diagnosisContext =
        `【既存の診断情報】\n` +
        `このユーザーは無料診断で「${phaseName}」と判定済みです。\n` +
        `診断ID: ${userData.submissionId}\n\n`;

      conversationId =
        userData.difyConversationId || "";
    }

    const difyInput =
      diagnosisContext +
      `【今回のユーザーメッセージ】\n` +
      userText;

    let difyResult;

try {
  difyResult = await callDify(
    difyInput,
    userId,
    env.DIFY_API_KEY,
    conversationId
  );

} catch (firstError) {

  // 保存済みconversation_idがある場合だけ、
  // 新規会話として1回だけ再試行する
  if (conversationId) {
    console.warn(
      "Existing Dify conversation failed. Retrying as new conversation:",
      firstError?.message || String(firstError)
    );

    difyResult = await callDify(
      difyInput,
      userId,
      env.DIFY_API_KEY,
      ""
    );

  } else {
    throw firstError;
  }
}

    // Difyから返ったconversation_idをKVへ保存
    if (difyResult.conversationId) {
      const latestText =
        await env.LINE_USERS.get(userId);

      const latest =
        latestText
          ? JSON.parse(latestText)
          : {};

      latest.difyConversationId =
        difyResult.conversationId;

      latest.updatedAt =
        new Date().toISOString();

      await env.LINE_USERS.put(
        userId,
        JSON.stringify(latest)
      );
    }

    let replyText = difyResult.answer;

if (
  replyText.includes(
    "[[OFFER_PRECISION_DIAGNOSIS]]"
  )
) {
  // まずタグ自体は必ず本文から消す
  replyText = replyText
    .replace(
      "[[OFFER_PRECISION_DIAGNOSIS]]",
      ""
    )
    .trim();

  const latestText =
    await env.LINE_USERS.get(userId);

  const latestUser =
    latestText
      ? JSON.parse(latestText)
      : {};

  const lastOfferAt =
    latestUser.precisionOfferSentAt
      ? new Date(
          latestUser.precisionOfferSentAt
        ).getTime()
      : 0;

  const sevenDays =
    7 * 24 * 60 * 60 * 1000;

  const canShowOffer =
    !Number.isFinite(lastOfferAt) ||
    Date.now() - lastOfferAt >= sevenDays;

  if (canShowOffer) {
    replyText +=
      "\n\n▼ 恋愛4フェーズ 精密診断\n" +
      "https://tksuga3-player.github.io/diag-x7k2p9/diagnosis-precision/";

    latestUser.precisionOfferSentAt =
      new Date().toISOString();

    latestUser.updatedAt =
      new Date().toISOString();

    await env.LINE_USERS.put(
      userId,
      JSON.stringify(latestUser)
    );
  }
}

try {
  await replyMessage(
    replyToken,
    replyText,
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
} catch (replyError) {
  console.error(
    "Reply failed, falling back to push:",
    replyError
  );

  await pushMessage(
    userId,
    replyText,
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

  } catch (error) {
  console.error(
    "Background processing error:",
    error
  );

  try {
    await pushMessage(
      userId,
      "今うまく回答を生成できませんでした。\n少し時間を置いて、もう一度送ってください。",
      env.LINE_CHANNEL_ACCESS_TOKEN
    );
  } catch (pushError) {
    console.error(
      "Fallback message failed:",
      pushError
    );
  }
}
}

async function callDify(
  userText,
  userId,
  apiKey,
  conversationId = ""
) {
  const body = {
    inputs: {},
    query: userText,
    response_mode: "blocking",
    user: userId
  };

  // 既存会話があるときだけconversation_idを付ける
  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const response = await fetch(
    "https://api.dify.ai/v1/chat-messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Dify failed: ${response.status} ${responseText}`
    );
  }

  const result =
    JSON.parse(responseText);

  if (!result.answer) {
    throw new Error(
      "Dify returned no answer"
    );
  }

  return {
    answer: result.answer,
    conversationId:
      result.conversation_id || ""
  };
}

async function replyMessage(replyToken, text, accessToken) {
  const safeText = String(text).slice(0, 5000);

  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text: safeText
          }
        ]
      }),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `LINE reply failed: ${response.status} ${responseText}`
    );
  }
}

async function pushMessage(userId, text, accessToken) {
  const safeText = String(text).slice(0, 5000);

  const response = await fetch(
    "https://api.line.me/v2/bot/message/push",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [
          {
            type: "text",
            text: safeText
          }
        ]
      }),
    }
  );

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `LINE push failed: ${response.status} ${responseText}`
    );
  }
}

async function verifyLineSignature(
  body,
  receivedSignature,
  channelSecret
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );

  const generatedSignature =
    arrayBufferToBase64(signatureBuffer);

  return timingSafeStringEqual(
    generatedSignature,
    receivedSignature
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function timingSafeStringEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

async function runFollowupPreview(env) {
  const now = Date.now();

  let cursor;
  let checked = 0;
  let step1Candidates = 0;
  let step2Candidates = 0;

  do {
    const page = await env.LINE_USERS.list(
      cursor ? { cursor } : {}
    );

    for (const key of page.keys) {
      const text = await env.LINE_USERS.get(key.name);

      if (!text) continue;

      const user = JSON.parse(text);
      checked++;

      if (!user.onboardingSentAt) {
        continue;
      }

      const start =
        new Date(user.onboardingSentAt).getTime();

      if (!Number.isFinite(start)) {
        continue;
      }

      const elapsedHours =
        (now - start) / (1000 * 60 * 60);

      const step1SendingAt = user.step1SendingAt
  ? new Date(user.step1SendingAt).getTime()
  : 0;

const step1LockIsFresh =
  Number.isFinite(step1SendingAt) &&
  (now - step1SendingAt) < (15 * 60 * 1000);

if (
  elapsedHours >= 24 &&
  !user.step1SentAt &&
  !step1LockIsFresh
) {
  console.log(
    "FOLLOWUP_STEP1_CANDIDATE",
    {
      userId: key.name,
      phase: user.phase,
      elapsedHours: Math.floor(elapsedHours)
    }
  );

  const followupText = getStep1Message(user.phase);

// 二重送信防止用の一時ロック
user.step1SendingAt = new Date().toISOString();
user.updatedAt = new Date().toISOString();

await env.LINE_USERS.put(
  key.name,
  JSON.stringify(user)
);

try {
  await pushMessage(
    key.name,
    followupText,
    env.LINE_CHANNEL_ACCESS_TOKEN
  );

  user.step1SentAt = new Date().toISOString();
  delete user.step1SendingAt;

  user.updatedAt = new Date().toISOString();

  await env.LINE_USERS.put(
    key.name,
    JSON.stringify(user)
  );

} catch (error) {
  // 送信自体が失敗した場合はロック解除して次回再試行可能にする
  delete user.step1SendingAt;

  user.updatedAt = new Date().toISOString();

  await env.LINE_USERS.put(
    key.name,
    JSON.stringify(user)
  );

  throw error;
}

  console.log(
    "FOLLOWUP_STEP1_SENT",
    {
      userId: key.name,
      phase: user.phase
    }
  );

  step1Candidates++;
  continue;
}

const step2SendingAt = user.step2SendingAt
  ? new Date(user.step2SendingAt).getTime()
  : 0;

const step2LockIsFresh =
  Number.isFinite(step2SendingAt) &&
  (now - step2SendingAt) < (15 * 60 * 1000);

      if (
  elapsedHours >= 72 &&
  user.step1SentAt &&
  !user.step2SentAt &&
  !step2LockIsFresh
) {
  console.log(
    "FOLLOWUP_STEP2_CANDIDATE",
    {
      userId: key.name,
      phase: user.phase,
      elapsedHours: Math.floor(elapsedHours)
    }
  );

  const followupText = getStep2Message(user.phase);

// 二重送信防止用の一時ロック
user.step2SendingAt = new Date().toISOString();
user.updatedAt = new Date().toISOString();

await env.LINE_USERS.put(
  key.name,
  JSON.stringify(user)
);

try {
  await pushMessage(
    key.name,
    followupText,
    env.LINE_CHANNEL_ACCESS_TOKEN
  );

  user.step2SentAt = new Date().toISOString();
  delete user.step2SendingAt;

  user.updatedAt = new Date().toISOString();

  await env.LINE_USERS.put(
    key.name,
    JSON.stringify(user)
  );

} catch (error) {
  delete user.step2SendingAt;

  user.updatedAt = new Date().toISOString();

  await env.LINE_USERS.put(
    key.name,
    JSON.stringify(user)
  );

  throw error;
}

  console.log(
    "FOLLOWUP_STEP2_SENT",
    {
      userId: key.name,
      phase: user.phase
    }
  );

  step2Candidates++;
}
    }

    cursor =
      page.list_complete
        ? undefined
        : page.cursor;

  } while (cursor);

  console.log(
    "FOLLOWUP_PREVIEW_COMPLETE",
    {
      checked,
      step1Candidates,
      step2Candidates
    }
  );
}

function getStep1Message(phase) {
  const messages = {
    0:
      "昨日の続きです。\nまずは接点を増やすところからです。昨日以降、新しく女性と話す・やり取りする機会はありましたか？",

    1:
      "昨日の続きです。\nまず見たいのは、相手が自然に会話を続けようとしているかです。最近のやり取りで、相手から質問や話題が返ってきた場面はありましたか？",

    2:
      "昨日の続きです。\n会話が成立しているなら、次は「楽しく話せる」から一段進む部分を見ます。最近、相手との距離が少し縮まったと感じる場面はありましたか？",

    3:
      "昨日の続きです。\n今は関係を長く安定させられるかを見る段階です。最近、相手との関係で不安定になったり、温度差を感じた場面はありましたか？",

    4:
      "昨日の続きです。\n最近の関係について、今いちばん気になっている変化を1つだけ教えてください。"
  };

  return (
    messages[phase] ||
    "昨日の続きです。最近のやり取りで、気になった反応を1つだけ教えてください。"
  );
}

function getStep2Message(phase) {
  const messages = {
    0:
      "その後、新しく女性と話す・やり取りする機会は作れましたか？\nできた/できなかっただけでも大丈夫です。",

    1:
      "その後、相手の反応に少し変化はありましたか？\n前より会話を切られにくくなった、距離を取られにくくなった、などがあれば教えてください。",

    2:
      "少し変化があったか確認したいです。\n前より会話が続きやすくなった、相手から質問や話題が増えた、などはありましたか？",

    3:
      "その後、相手との距離感に変化はありましたか？\n前より誘いに乗ってくる、会う流れが作りやすい、異性としての反応が少し出た、などがあれば教えてください。",

    4:
      "その後、関係の安定感に変化はありましたか？\n前より温度差が減った、やり取りが安定した、同じ衝突が減った、などがあれば教えてください。"
  };

  return (
    messages[phase] ||
    "その後、少し変化はありましたか？最近のやり取りで気になった反応を1つだけ教えてください。"
  );
}
