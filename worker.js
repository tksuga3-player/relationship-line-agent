const encoder = new TextEncoder();

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

async function processMessage(userText, userId, replyToken, env) {
  try {
    let diagnosisContext = "";
    let conversationId = "";

    const saved = await env.LINE_USERS.get(userId);

    if (saved) {
      const userData = JSON.parse(saved);

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