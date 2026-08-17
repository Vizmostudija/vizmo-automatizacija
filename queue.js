const axios = require('axios');
const cron = require('node-cron');
const db = require('./db');
const {
  randomDelay,
  buildDmMessage,
  getPublicReplyMessage,
} = require('./utils');

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

let isProcessing = false;

function getRateLimitStatus() {
  const hourlyCount = db.getSentCountLastHour();
  const dailyCount = db.getSentCountToday();

  return {
    hourlyCount,
    dailyCount,
    hourlyLimitReached: hourlyCount >= db.HOURLY_LIMIT,
    dailyLimitReached: dailyCount >= db.DAILY_LIMIT,
    canSend: hourlyCount < db.HOURLY_LIMIT && dailyCount < db.DAILY_LIMIT,
  };
}

function extractApiError(error) {
  const statusCode = error.response?.status || null;
  const apiMessage =
    error.response?.data?.error?.message ||
    error.response?.data?.message ||
    error.message ||
    'Unknown error';

  return { statusCode, apiMessage };
}

async function sendPrivateReply(commentId, message, accessToken) {
  const url = `${GRAPH_BASE_URL}/${commentId}/private_replies`;
  const response = await axios.post(
    url,
    { message },
    {
      params: { access_token: accessToken },
      timeout: 30000,
    }
  );
  return response.data;
}

async function sendPublicReply(commentId, message, accessToken) {
  const url = `${GRAPH_BASE_URL}/${commentId}/replies`;
  const response = await axios.post(
    url,
    { message },
    {
      params: { access_token: accessToken },
      timeout: 30000,
    }
  );
  return response.data;
}

/**
 * Process a single queue item: send DM + public reply.
 */
async function processQueueItem(item, config) {
  const { pageAccessToken, testLink } = config;
  const dmMessage = buildDmMessage(testLink);
  const publicReply = getPublicReplyMessage();

  db.markQueueProcessing(item.id);

  try {
    await sendPrivateReply(item.comment_id, dmMessage, pageAccessToken);

    await randomDelay(3000, 10000);

    await sendPublicReply(item.comment_id, publicReply, pageAccessToken);

    db.recordSentMessage({
      commentId: item.comment_id,
      userId: item.user_id,
      username: item.username,
    });

    db.markQueueSent(item.id);

    return { success: true };
  } catch (error) {
    const { statusCode, apiMessage } = extractApiError(error);

    db.logError({
      username: item.username,
      errorMessage: apiMessage,
      statusCode,
      context: {
        commentId: item.comment_id,
        userId: item.user_id,
        queueItemId: item.id,
      },
    });

    db.markQueueFailed(item.id, apiMessage);

    return { success: false, error: apiMessage, statusCode };
  }
}

/**
 * Attempt to send immediately or enqueue if rate limits are reached.
 */
async function handleIncomingComment(comment, config) {
  const { commentId, userId, username, text } = comment;

  const enqueued = db.enqueueMessage({
    commentId,
    userId,
    username,
    commentText: text,
  });

  if (!enqueued) {
    return { action: 'duplicate', message: 'Comment already processed or queued' };
  }

  const limits = getRateLimitStatus();

  if (!limits.canSend) {
    return {
      action: 'queued',
      reason: limits.dailyLimitReached ? 'daily_limit' : 'hourly_limit',
      pendingCount: db.getPendingQueueCount(),
    };
  }

  await processPendingQueue(config);

  const item = db.getQueueItemByCommentId(commentId);

  if (item?.status === 'SENT') {
    return { action: 'sent', success: true };
  }

  if (item?.status === 'FAILED') {
    return { action: 'failed', success: false, error: item.error_message };
  }

  return {
    action: 'queued',
    reason: 'processing_deferred',
    pendingCount: db.getPendingQueueCount(),
  };
}

/**
 * Background worker: process pending queue items respecting rate limits.
 */
async function processPendingQueue(config) {
  if (isProcessing) {
    console.log('[Queue] Skipping run — previous batch still processing');
    return;
  }

  isProcessing = true;

  try {
    const limits = getRateLimitStatus();

    if (!limits.canSend) {
      console.log(
        `[Queue] Rate limit active — hourly: ${limits.hourlyCount}/${db.HOURLY_LIMIT}, daily: ${limits.dailyCount}/${db.DAILY_LIMIT}`
      );
      return;
    }

    const pending = db.getPendingQueueItems(50);
    if (pending.length === 0) return;

    console.log(`[Queue] Processing ${pending.length} pending item(s)`);

    let processed = 0;

    for (const item of pending) {
      const currentLimits = getRateLimitStatus();
      if (!currentLimits.canSend) {
        console.log('[Queue] Rate limit reached mid-batch — stopping');
        break;
      }

      await processQueueItem(item, config);
      processed++;

      const stillPending = db.getPendingQueueCount();
      if (stillPending > 0) {
        await randomDelay(3000, 10000);
      }
    }

    console.log(`[Queue] Processed ${processed} item(s)`);
  } catch (error) {
    console.error('[Queue] Worker error:', error.message);
    db.logError({
      username: null,
      errorMessage: error.message,
      statusCode: null,
      context: { source: 'queue_worker' },
    });
  } finally {
    isProcessing = false;
  }
}

function startQueueWorker(config) {
  cron.schedule('*/5 * * * *', () => {
    console.log('[Queue] Cron tick — checking pending messages');
    processPendingQueue(config).catch((err) => {
      console.error('[Queue] Unhandled cron error:', err);
    });
  });

  console.log('[Queue] Background worker scheduled (every 5 minutes)');

  setTimeout(() => {
    processPendingQueue(config).catch((err) => {
      console.error('[Queue] Initial run error:', err);
    });
  }, 5000);
}

module.exports = {
  getRateLimitStatus,
  handleIncomingComment,
  processPendingQueue,
  startQueueWorker,
  sendPrivateReply,
  sendPublicReply,
};
