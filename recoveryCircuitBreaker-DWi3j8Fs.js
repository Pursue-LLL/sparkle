const require_chunk = require("./chunk-Ble4zEEl.js");
const require_recoveryCircuitBreakerCore = require("./recoveryCircuitBreakerCore-CJ7knbde.js");
//#region src/main/core/recoveryCircuitBreaker.ts
function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
async function assertRecoveryCircuitAllowsMutation(input) {
	if (!require_recoveryCircuitBreakerCore.isRecoveryCircuitOpen({
		nowMs: input.nowMs,
		state
	})) return { allowed: true };
	maybeEscalateCircuitOpenCoreRestart(input.nowMs);
	return {
		allowed: false,
		reason: `recovery_circuit_breaker_open until_ms=${state.openUntilMs} last=${state.lastFailureReason}`
	};
}
async function evaluateEscalateRestartGuard() {
	const { evaluateMarathonCoreColdRestart } = await Promise.resolve().then(() => require("./index.js"));
	let timedOut = false;
	return {
		...await Promise.race([evaluateMarathonCoreColdRestart("restartCore", true), delay(ESCALATE_GUARD_TIMEOUT_MS).then(async () => {
			timedOut = true;
			return {
				blocked: true,
				snapshot: {
					quiesceActive: false,
					cursorConnectionCount: -1,
					recentActiveLifecycleStreamCount: -1,
					updatedAtMs: Date.now()
				}
			};
		})]),
		timedOut
	};
}
async function logCoreRestartDeferred(reason, nowMs, force = false) {
	if (!force && nowMs - lastCoreRestartDeferLogAtMs < CORE_RESTART_DEFER_LOG_COOLDOWN_MS) return;
	lastCoreRestartDeferLogAtMs = nowMs;
	const { appendAppLog } = await Promise.resolve().then(() => require("./log-BWb6zSSG.js")).then((n) => (n.init_log(), n.log_exports));
	await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
		outcome: "blocked",
		reason
	}));
}
async function maybeEscalateCircuitOpenCoreRestart(nowMs) {
	if (coreRestartInFlight) return;
	coreRestartInFlight = true;
	try {
		const guard = await evaluateEscalateRestartGuard();
		if (guard.blocked) {
			coreRestartPending = true;
			await logCoreRestartDeferred(guard.timedOut ? "core_restart_deferred guard_eval_timeout_ms=" + String(ESCALATE_GUARD_TIMEOUT_MS) : `core_restart_deferred cursor_conn=${guard.snapshot.cursorConnectionCount} ${guard.snapshot.quiesceActive ? "quiesce=1" : "quiesce=0"}`, nowMs, !lastCoreRestartDeferLogAtMs);
			return;
		}
		const { appendAppLog } = await Promise.resolve().then(() => require("./log-BWb6zSSG.js")).then((n) => (n.init_log(), n.log_exports));
		await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
			outcome: "open",
			reason: coreRestartPending ? "circuit_open_escalate_restartCore_retry" : "circuit_open_escalate_restartCore"
		}));
		const { restartCore } = await Promise.resolve().then(() => require("./index.js"));
		await restartCore(true);
		state = require_recoveryCircuitBreakerCore.recordRecoverySuccess(state);
		coreRestartPending = false;
		await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
			outcome: "reset",
			reason: "core_restart_after_circuit_open",
			consecutiveFailures: 0
		}));
	} catch (error) {
		coreRestartPending = true;
		await logCoreRestartDeferred(`core_restart_escalate_error ${error instanceof Error ? error.message : String(error)}`, nowMs, true);
	} finally {
		coreRestartInFlight = false;
	}
}
async function notifyRecoveryCircuitSuccess() {
	const next = require_recoveryCircuitBreakerCore.recordRecoverySuccess(state);
	if (next.consecutiveFailures === state.consecutiveFailures && next.openUntilMs === state.openUntilMs) return;
	state = next;
	coreRestartPending = false;
	const { appendAppLog } = await Promise.resolve().then(() => require("./log-BWb6zSSG.js")).then((n) => (n.init_log(), n.log_exports));
	await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
		outcome: "reset",
		reason: "recovery_success",
		consecutiveFailures: 0
	}));
}
async function notifyRecoveryCircuitFailure(input) {
	const result = require_recoveryCircuitBreakerCore.recordRecoveryFailure({
		nowMs: input.nowMs,
		state,
		reason: input.reason
	});
	state = result.state;
	const { appendAppLog } = await Promise.resolve().then(() => require("./log-BWb6zSSG.js")).then((n) => (n.init_log(), n.log_exports));
	if (result.opened) {
		coreRestartPending = true;
		await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
			outcome: "open",
			reason: input.reason,
			consecutiveFailures: state.consecutiveFailures,
			openUntilMs: state.openUntilMs,
			cooldownMs: state.openUntilMs - input.nowMs
		}));
		const { showNotification } = await Promise.resolve().then(() => require("./notification-BNcQPIVG.js")).then((n) => (n.init_notification(), n.notification_exports));
		showNotification({
			id: "recovery-circuit-breaker-open",
			title: "代理恢复已熔断 / Proxy Recovery Circuit Open",
			body: "连续 3 次 parent UDP 恢复失败，已自动尝试重启核心。若仍异常请 Cmd+Q 退出 Sparkle 和 Cursor 后重开。\n3 consecutive parent recovery failures; core restart attempted. If still stuck, Cmd+Q Sparkle + Cursor and reopen.",
			variant: "danger",
			persistent: true
		});
		maybeEscalateCircuitOpenCoreRestart(input.nowMs);
		return;
	}
	await appendAppLog(require_recoveryCircuitBreakerCore.formatRecoveryCircuitBreakerLogLine({
		outcome: "closed",
		reason: input.reason,
		consecutiveFailures: state.consecutiveFailures
	}));
}
var state, coreRestartPending, coreRestartInFlight, lastCoreRestartDeferLogAtMs, ESCALATE_GUARD_TIMEOUT_MS, CORE_RESTART_DEFER_LOG_COOLDOWN_MS;
var init_recoveryCircuitBreaker = require_chunk.__esmMin((() => {
	require_recoveryCircuitBreakerCore.init_recoveryCircuitBreakerCore();
	state = require_recoveryCircuitBreakerCore.createInitialRecoveryCircuitBreakerState();
	coreRestartPending = false;
	coreRestartInFlight = false;
	lastCoreRestartDeferLogAtMs = 0;
	ESCALATE_GUARD_TIMEOUT_MS = 12e3;
	CORE_RESTART_DEFER_LOG_COOLDOWN_MS = 6e4;
}));
//#endregion
init_recoveryCircuitBreaker();
exports.assertRecoveryCircuitAllowsMutation = assertRecoveryCircuitAllowsMutation;
Object.defineProperty(exports, "init_recoveryCircuitBreaker", {
	enumerable: true,
	get: function() {
		return init_recoveryCircuitBreaker;
	}
});
exports.notifyRecoveryCircuitFailure = notifyRecoveryCircuitFailure;
exports.notifyRecoveryCircuitSuccess = notifyRecoveryCircuitSuccess;
