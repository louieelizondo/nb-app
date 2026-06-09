/**
 * ═══════════════════════════════════════════════════════════════
 * NB · Scheduled Triggers
 * ═══════════════════════════════════════════════════════════════
 *
 * Registers and handles time-based triggers for the NB backend.
 *
 * SETUP (one-time, run from Apps Script editor):
 *   setupDailyRecomputeTrigger()
 *
 * This creates a daily trigger at 6pm MX time that calls
 * dailyRecomputeTrigger() automatically.
 *
 * Author: Claude + Louie · 2026-06-09
 */

// ─── Setup ────────────────────────────────────────────────────────────────

/**
 * ONE-TIME: Run this from the Apps Script editor to register the daily
 * 6pm recompute trigger. Safe to re-run — deletes any existing trigger
 * with the same handler name before creating a new one (idempotent).
 */
function setupDailyRecomputeTrigger() {
  // Delete existing triggers for this handler to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyRecomputeTrigger') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create new daily trigger at 18:00–19:00 MX time
  ScriptApp.newTrigger('dailyRecomputeTrigger')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .inTimezone('America/Chihuahua')
    .create();

  Logger.log('✅ Daily recompute trigger set for 6pm MX time (America/Chihuahua)');
  return { ok: true };
}

/**
 * Lists all registered project triggers (useful for debugging).
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    Logger.log(t.getHandlerFunction() + ' · ' + t.getEventType() + ' · ' + t.getTriggerSource());
  });
  return triggers.map(t => ({
    handler:  t.getHandlerFunction(),
    type:     t.getEventType(),
    source:   t.getTriggerSource(),
    uniqueId: t.getUniqueId()
  }));
}

// ─── Daily recompute ──────────────────────────────────────────────────────

/**
 * Called automatically every day at ~6pm MX time by the ScriptApp trigger.
 * Recomputes ASISTENCIA_SEMANAL for:
 *   - The current week (Vie→Jue window that contains today)
 *   - The previous week (catches late xlsx uploads or corrections)
 *
 * Safe to run mid-week — recompute is idempotent and preserves manual
 * overrides (FaltasReal, FaltasJustificadas, Locked rows, Ajustes).
 */
function dailyRecomputeTrigger() {
  const todayStr = Utilities.formatDate(new Date(), 'America/Chihuahua', 'yyyy-MM-dd');
  const currentWeek = vieJueWeek_(todayStr);
  const prevWeekEnd = addDaysStr_(currentWeek.start, -1);
  const prevWeek    = vieJueWeek_(prevWeekEnd);

  const results = {};

  try {
    const r1 = recomputeSemanal(currentWeek.start, currentWeek.end, 'daily_trigger');
    results.currentWeek = { week: currentWeek.start, ok: true, computed: r1.computed };
    Logger.log('Daily recompute · current week ' + currentWeek.start + ': ' + (r1.computed || 0) + ' employees');
  } catch (e) {
    results.currentWeek = { week: currentWeek.start, ok: false, error: e.message };
    Logger.log('Daily recompute ERROR · current week: ' + e.message);
  }

  try {
    const r2 = recomputeSemanal(prevWeek.start, prevWeek.end, 'daily_trigger');
    results.prevWeek = { week: prevWeek.start, ok: true, computed: r2.computed };
    Logger.log('Daily recompute · prev week ' + prevWeek.start + ': ' + (r2.computed || 0) + ' employees');
  } catch (e) {
    results.prevWeek = { week: prevWeek.start, ok: false, error: e.message };
    Logger.log('Daily recompute ERROR · prev week: ' + e.message);
  }

  log('DAILY_RECOMPUTE', JSON.stringify(results));
  return results;
}

// ─── Manual trigger (callable from frontend or editor) ───────────────────

/**
 * Recomputes both current and previous week on demand.
 * Called by the "Recomputar" button in reporte_semanal.html via:
 *   { action: 'recompute_now' }
 *
 * Also callable directly from the Apps Script editor for ad-hoc runs.
 */
function recomputeNow() {
  return dailyRecomputeTrigger();
}
