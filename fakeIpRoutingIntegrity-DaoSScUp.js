const require_chunk = require("./chunk-Ble4zEEl.js");
//#region src/main/core/fakeIpRoutingIntegrity.ts
var fakeIpRoutingIntegrity_exports = /* @__PURE__ */ require_chunk.__exportAll({
	TIER0_FAKE_IP_FILTER: () => TIER0_FAKE_IP_FILTER,
	applySnifferIntegrityPatch: () => applySnifferIntegrityPatch,
	buildControlledFakeIpFilter: () => buildControlledFakeIpFilter,
	buildTieredFakeIpFilter: () => buildTieredFakeIpFilter,
	collectTier1FakeIpFilterEntries: () => collectTier1FakeIpFilterEntries,
	ensureFakeIpRoutingIntegrity: () => ensureFakeIpRoutingIntegrity,
	mergeFakeIpFilterEntries: () => mergeFakeIpFilterEntries,
	sanitizeFakeIpDirectCidrRules: () => sanitizeFakeIpDirectCidrRules
});
function isDirectIntentTarget(target) {
	if (RULE_BUILTIN_TARGETS.has(target)) return true;
	return /直连|全球拦截/.test(target);
}
function stripRuleModifiers(parts) {
	const copy = [...parts];
	while (copy.length > 0 && RULE_MODIFIERS.has(copy[copy.length - 1].trim())) copy.pop();
	return copy;
}
function resolveRuleTarget(rule) {
	const normalized = rule.trim().replace(/\s+/g, " ");
	if (!normalized || normalized.startsWith("#")) return;
	const parts = stripRuleModifiers(normalized.split(","));
	if (parts.length < 3) return;
	return parts[parts.length - 1]?.trim();
}
function isTldOnlySuffix(payload) {
	return TLD_ONLY_SUFFIX.test(payload.trim());
}
function suffixLabelDepth(payload) {
	const trimmed = payload.trim().replace(/^\./, "");
	if (!trimmed) return 0;
	return trimmed.split(".").filter(Boolean).length;
}
function toFakeIpFilterEntry(kind, payload) {
	const trimmed = payload.trim();
	if (!trimmed || trimmed === ".") return null;
	if (kind === "DOMAIN-SUFFIX") {
		if (isTldOnlySuffix(trimmed) || suffixLabelDepth(trimmed) < 2) return null;
		if (trimmed.startsWith(".")) return `+${trimmed}`;
		return `+.${trimmed}`;
	}
	if (trimmed.startsWith(".")) return suffixLabelDepth(trimmed) >= 2 ? `+${trimmed}` : null;
	return trimmed;
}
function collectDomainEntries(rule) {
	const entries = [];
	for (const match of rule.matchAll(DOMAIN_PATTERN)) {
		const payload = match[1]?.trim();
		if (!payload) continue;
		const entry = toFakeIpFilterEntry("DOMAIN", payload);
		if (entry) entries.push(entry);
	}
	for (const match of rule.matchAll(DOMAIN_SUFFIX_PATTERN)) {
		const payload = match[1]?.trim();
		if (!payload) continue;
		const entry = toFakeIpFilterEntry("DOMAIN-SUFFIX", payload);
		if (entry) entries.push(entry);
	}
	return entries;
}
function mergeFakeIpFilterEntries(existing, additions) {
	const merged = new Set(existing ?? []);
	for (const entry of additions) merged.add(entry);
	return [...merged];
}
function isFakeIpDirectCidrRule(rule) {
	const normalized = rule.trim().replace(/\s+/g, " ");
	if (!normalized || normalized.startsWith("#")) return false;
	const parts = stripRuleModifiers(normalized.split(","));
	if (parts.length < 3 || parts[0]?.trim() !== "IP-CIDR") return false;
	const cidr = parts[1]?.trim();
	if (!cidr || !FAKE_IP_DIRECT_CIDR_TARGETS.includes(cidr)) return false;
	const target = parts[2]?.trim() ?? "";
	return target === "DIRECT" || /直连/.test(target);
}
function isFakeIpRoutingActive(profile) {
	if (profile.dns?.enable !== true) return false;
	if (profile.dns["enhanced-mode"] !== "fake-ip") return false;
	return profile.profile?.["store-fake-ip"] !== false;
}
/** Tier 1 — selective suffixes from proxy-intent rules (Type B fallback, not bulk dump). */
function collectTier1FakeIpFilterEntries(rules) {
	if (!rules?.length) return [];
	const entries = /* @__PURE__ */ new Set();
	for (const rule of rules) {
		const target = resolveRuleTarget(rule);
		if (!target || isDirectIntentTarget(target)) continue;
		for (const entry of collectDomainEntries(rule)) entries.add(entry);
	}
	return [...entries].sort();
}
function buildTieredFakeIpFilter(options) {
	const tier0 = [...TIER0_FAKE_IP_FILTER];
	const tier1 = options.includeTier1 === false ? [] : collectTier1FakeIpFilterEntries(options.rules);
	return mergeFakeIpFilterEntries(mergeFakeIpFilterEntries(options.existing, tier0), tier1);
}
/** Layer 1 — remove legacy fake-ip CIDR → DIRECT trap from subscription rules. */
function sanitizeFakeIpDirectCidrRules(profile) {
	if (!isFakeIpRoutingActive(profile)) return 0;
	const rules = profile.rules;
	if (!rules?.length) return 0;
	const next = rules.filter((rule) => !isFakeIpDirectCidrRule(rule));
	const removed = rules.length - next.length;
	if (removed > 0) profile.rules = next;
	return removed;
}
/** Layer 3 — ensure fake-ip DNS mapping is active for pure-IP connections (incl. UDP STUN). */
function applySnifferIntegrityPatch(sniffer) {
	const base = sniffer ?? {};
	return {
		...base,
		enable: base.enable ?? true,
		"parse-pure-ip": true,
		"force-dns-mapping": true,
		"override-destination": base["override-destination"] ?? false
	};
}
/** Apply all fake-ip routing integrity layers to a runtime profile. */
function ensureFakeIpRoutingIntegrity(profile) {
	const removedFakeIpCidrRules = sanitizeFakeIpDirectCidrRules(profile);
	if (!isFakeIpRoutingActive(profile)) return {
		removedFakeIpCidrRules,
		fakeIpFilterCount: profile.dns?.["fake-ip-filter"]?.length ?? 0
	};
	const dns = profile.dns;
	dns["fake-ip-filter"] = buildTieredFakeIpFilter({
		existing: dns["fake-ip-filter"],
		includeTier1: false
	});
	if (profile.sniffer?.enable !== false) profile.sniffer = applySnifferIntegrityPatch(profile.sniffer);
	return {
		removedFakeIpCidrRules,
		fakeIpFilterCount: dns["fake-ip-filter"]?.length ?? 0
	};
}
/** Controlled mihomo.yaml patch — Tier 0 only (no subscription rules at this layer). */
function buildControlledFakeIpFilter(existing) {
	return buildTieredFakeIpFilter({
		existing,
		includeTier1: false
	});
}
var RULE_BUILTIN_TARGETS, RULE_MODIFIERS, TIER0_FAKE_IP_FILTER, FAKE_IP_DIRECT_CIDR_TARGETS, TLD_ONLY_SUFFIX, DOMAIN_PATTERN, DOMAIN_SUFFIX_PATTERN;
var init_fakeIpRoutingIntegrity = require_chunk.__esmMin((() => {
	RULE_BUILTIN_TARGETS = new Set([
		"DIRECT",
		"REJECT",
		"REJECT-DROP",
		"PASS",
		"DNS",
		"NOOP"
	]);
	RULE_MODIFIERS = new Set(["no-resolve"]);
	TIER0_FAKE_IP_FILTER = [
		"+.cursor.sh",
		"+.cursor.com",
		"+.cursorapi.com",
		"+.cursor-cdn.com",
		"+.workers.dev",
		"cursor.sh"
	];
	FAKE_IP_DIRECT_CIDR_TARGETS = ["198.18.0.0/16", "198.19.0.0/16"];
	TLD_ONLY_SUFFIX = /^\.[a-z0-9-]{2,63}$/i;
	DOMAIN_PATTERN = /\bDOMAIN,([^,)]+)/g;
	DOMAIN_SUFFIX_PATTERN = /\bDOMAIN-SUFFIX,([^,)]+)/g;
}));
//#endregion
Object.defineProperty(exports, "TIER0_FAKE_IP_FILTER", {
	enumerable: true,
	get: function() {
		return TIER0_FAKE_IP_FILTER;
	}
});
Object.defineProperty(exports, "buildControlledFakeIpFilter", {
	enumerable: true,
	get: function() {
		return buildControlledFakeIpFilter;
	}
});
Object.defineProperty(exports, "fakeIpRoutingIntegrity_exports", {
	enumerable: true,
	get: function() {
		return fakeIpRoutingIntegrity_exports;
	}
});
Object.defineProperty(exports, "init_fakeIpRoutingIntegrity", {
	enumerable: true,
	get: function() {
		return init_fakeIpRoutingIntegrity;
	}
});
