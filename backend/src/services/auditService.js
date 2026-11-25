const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');

async function recordAudit({
  req = null,
  actor = null,
  action,
  targetCollection,
  targetId = '',
  summary,
  metadata = {},
}) {
  try {
    const resolvedActor = actor || (req && req.user) || null;
    await AuditLog.create({
      actorId: resolvedActor ? resolvedActor.id : null,
      actorEmail: resolvedActor ? resolvedActor.email : 'system',
      actorRole: resolvedActor ? resolvedActor.role : 'system',
      action,
      targetCollection,
      targetId: String(targetId || ''),
      summary,
      metadata,
      ipAddress: req ? req.ip || '' : '',
      timestamp: new Date(),
    });
  } catch (err) {
    // Audit write failures are logged without crashing already-committed operational writes.
    logger.error('Failed to persist audit log entry', { action, error: err.message });
  }
}

module.exports = { recordAudit };
