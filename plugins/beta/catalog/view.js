//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/shared/utils.js
var e = Array.isArray, t = Array.prototype.indexOf, n = Array.prototype.includes, r = Array.from, i = Object.defineProperty, a = Object.getOwnPropertyDescriptor, o = Object.getOwnPropertyDescriptors, s = Object.prototype, c = Array.prototype, l = Object.getPrototypeOf, u = Object.isExtensible, d = () => {};
function f(e) {
	for (var t = 0; t < e.length; t++) e[t]();
}
function p() {
	var e, t;
	return {
		promise: new Promise((n, r) => {
			e = n, t = r;
		}),
		resolve: e,
		reject: t
	};
}
function m(e, t) {
	if (Array.isArray(e)) return e;
	if (t === void 0 || !(Symbol.iterator in e)) return Array.from(e);
	let n = [];
	for (let r of e) if (n.push(r), n.length === t) break;
	return n;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/constants.js
var h = 1 << 24, g = 1024, _ = 2048, v = 4096, y = 8192, b = 16384, x = 32768, S = 1 << 25, ee = 65536, te = 1 << 19, ne = 1 << 20, re = 1 << 25, ie = 1 << 21, ae = 1 << 22, oe = 1 << 23, se = Symbol("$state"), ce = Symbol("component"), le = Symbol("legacy props"), ue = Symbol(""), de = Symbol("attributes"), fe = Symbol("class"), pe = Symbol("style"), me = Symbol("text"), C = Symbol("form reset"), he = new class extends Error {
	name = "StaleReactionError";
	message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), ge = !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml"), w = {}, T = Symbol("uninitialized"), _e = "http://www.w3.org/1999/xhtml", ve = "http://www.w3.org/2000/svg", ye = "http://www.w3.org/1998/Math/MathML";
function be() {
	console.warn("https://svelte.dev/e/derived_inert");
}
function xe(e) {
	console.warn("https://svelte.dev/e/hydration_mismatch");
}
function E() {
	console.warn("https://svelte.dev/e/select_multiple_invalid_value");
}
function Se() {
	console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/hydration.js
var D = !1;
function Ce(e) {
	D = e;
}
var O;
function we(e) {
	if (e === null) throw xe(), w;
	return O = e;
}
function Te() {
	return we(/* @__PURE__ */ rn(O));
}
function k(e) {
	if (D) {
		if (/* @__PURE__ */ rn(O) !== null) throw xe(), w;
		O = e;
	}
}
function Ee(e = 1) {
	if (D) {
		for (var t = e, n = O; t--;) n = /* @__PURE__ */ rn(n);
		O = n;
	}
}
function De(e = !0) {
	for (var t = 0, n = O;;) {
		if (n.nodeType === 8) {
			var r = n.data;
			if (r === "]") {
				if (t === 0) return n;
				--t;
			} else (r === "[" || r === "[!" || r[0] === "[" && !isNaN(Number(r.slice(1)))) && (t += 1);
		}
		var i = /* @__PURE__ */ rn(n);
		e && n.remove(), n = i;
	}
}
function Oe(e) {
	if (!e || e.nodeType !== 8) throw xe(), w;
	return e.data;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/equality.js
function ke(e) {
	return e === this.v;
}
function Ae(e, t) {
	return e == e ? e !== t || typeof e == "object" && !!e || typeof e == "function" : t == t;
}
function je(e) {
	return !Ae(e, this.v);
}
function Me(e) {
	throw Error("https://svelte.dev/e/lifecycle_outside_component");
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/errors.js
function Ne() {
	throw Error("https://svelte.dev/e/async_derived_orphan");
}
function Pe(e, t, n) {
	throw Error("https://svelte.dev/e/each_key_duplicate");
}
function A(e) {
	throw Error("https://svelte.dev/e/effect_in_teardown");
}
function Fe() {
	throw Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function Ie(e) {
	throw Error("https://svelte.dev/e/effect_orphan");
}
function Le() {
	throw Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function Re(e) {
	throw Error("https://svelte.dev/e/props_invalid_value");
}
function ze() {
	throw Error("https://svelte.dev/e/state_descriptors_fixed");
}
function Be() {
	throw Error("https://svelte.dev/e/state_prototype_fixed");
}
function Ve() {
	throw Error("https://svelte.dev/e/state_unsafe_mutation");
}
function He() {
	throw Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/context.js
var j = null;
function Ue(e) {
	j = e;
}
function We(e, t = !1, n) {
	j = {
		p: j,
		i: !1,
		c: null,
		e: null,
		s: e,
		x: null,
		r: W,
		l: null
	};
}
function Ge(e) {
	var t = j, n = t.e;
	if (n !== null) {
		t.e = null;
		for (var r of n) vn(r);
	}
	return e !== void 0 && (t.x = e), t.i = !0, j = t.p, Ke(e);
}
function Ke(e = {}) {
	return i(e, ce, { value: !0 }), e;
}
function qe() {
	return !0;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/task.js
var Je = [];
function Ye() {
	var e = Je;
	Je = [], f(e);
}
function M(e) {
	if (Je.length === 0 && !Ct) {
		var t = Je;
		queueMicrotask(() => {
			t === Je && Ye();
		});
	}
	Je.push(e);
}
function Xe() {
	for (; Je.length > 0;) Ye();
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/status.js
var Ze = ~(_ | v | g);
function N(e, t) {
	e.f = e.f & Ze | t;
}
function Qe(e) {
	e.f & 512 || e.deps === null ? N(e, g) : N(e, v);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/utils.js
function $e(e, t, n) {
	e.f & 2048 ? t.add(e) : e.f & 4096 && n.add(e), N(e, g);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/misc.js
function et(e, t) {
	if (t) {
		let t = document.body;
		e.autofocus = !0, M(() => {
			document.activeElement === t && e.focus();
		});
	}
}
function tt(e) {
	D && /* @__PURE__ */ nn(e) !== null && on(e);
}
var nt = !1;
function rt() {
	nt || (nt = !0, document.addEventListener("reset", (e) => {
		Promise.resolve().then(() => {
			if (!e.defaultPrevented) for (let t of e.target.elements) t[C]?.();
		});
	}, { capture: !0 }));
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/bindings/shared.js
function it(e) {
	var t = U, n = W;
	Hn(null), Un(null);
	try {
		return e();
	} finally {
		Hn(t), Un(n);
	}
}
function at(e, t, n, r = n) {
	e.addEventListener(t, () => it(n));
	let i = e[C];
	e[C] = i ? () => {
		i(), r(!0);
	} : () => r(!0), rt();
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/async.js
function ot(e, t, n, r) {
	let i = qe() ? ut : pt;
	var a = e.filter((e) => !e.settled), o = t.map(i);
	if (n.length === 0 && a.length === 0) {
		r(o);
		return;
	}
	var s = W, c = st(), l = a.length === 1 ? a[0].promise : a.length > 1 ? Promise.all(a.map((e) => e.promise)) : null;
	function u(e) {
		if (!(s.f & 16384)) {
			c();
			try {
				r([...o, ...e]);
			} catch (e) {
				dn(e, s);
			}
			ct();
		}
	}
	var d = lt();
	if (n.length === 0) {
		l.then(() => u([])).finally(d);
		return;
	}
	function f() {
		Promise.all(n.map((e) => /* @__PURE__ */ ft(e))).then(u).catch((e) => dn(e, s)).finally(d);
	}
	l ? l.then(() => {
		c(), f(), ct();
	}) : f();
}
function st() {
	var e = W, t = U, n = j, r = F;
	return function(i = !0) {
		Un(e), Hn(t), Ue(n), i && !(e.f & 16384) && (r?.activate(), r?.apply());
	};
}
function ct(e = !0) {
	Un(null), Hn(null), Ue(null), e && F?.deactivate();
}
function lt() {
	var e = W, t = e.b, n = F, r = !!t?.is_rendered();
	return t?.update_pending_count(1, n), n.increment(r, e), () => {
		t?.update_pending_count(-1, n), n.decrement(r, e);
	};
}
/*#__NO_SIDE_EFFECTS__*/
function ut(e) {
	var t = 2 | _;
	return W !== null && (W.f |= te), {
		ctx: j,
		deps: null,
		effects: null,
		equals: ke,
		f: t,
		fn: e,
		reactions: null,
		rv: 0,
		v: T,
		wv: 0,
		parent: W,
		ac: null
	};
}
var dt = Symbol("obsolete");
/*#__NO_SIDE_EFFECTS__*/
function ft(e, t, n) {
	let r = W;
	r === null && Ne();
	var i = void 0, a = Bt(T), o = !U, s = /* @__PURE__ */ new Set();
	return xn(() => {
		var t = W, n = p();
		i = n.promise;
		try {
			Promise.resolve(e()).then(n.resolve, (e) => {
				e !== he && n.reject(e);
			}).finally(ct);
		} catch (e) {
			n.reject(e), ct();
		}
		var c = F;
		if (o) {
			if (t.f & 32768) var l = lt();
			if (r.b?.is_rendered()) c.async_deriveds.get(t)?.reject(dt);
			else for (let e of s.values()) e.reject(dt);
			s.add(n), c.async_deriveds.set(t, n);
		}
		let u = (e, t = void 0) => {
			l?.(), s.delete(n), t !== dt && (c.activate(), t ? (a.f |= oe, Wt(a, t)) : (a.f & 8388608 && (a.f ^= oe), Wt(a, e)), c.deactivate());
		};
		n.promise.then(u, (e) => u(null, e || "unknown"));
	}), gn(() => {
		for (let e of s) e.reject(dt);
	}), new Promise((e) => {
		function t(n) {
			function r() {
				n === i ? e(a) : t(i);
			}
			n.then(r, r);
		}
		t(i);
	});
}
/*#__NO_SIDE_EFFECTS__*/
function P(e) {
	let t = /* @__PURE__ */ ut(e);
	return Gn(t), t;
}
/*#__NO_SIDE_EFFECTS__*/
function pt(e) {
	let t = /* @__PURE__ */ ut(e);
	return t.equals = je, t;
}
function mt(e) {
	var t = e.effects;
	if (t !== null) {
		e.effects = null;
		for (var n = 0; n < t.length; n += 1) kn(t[n]);
	}
}
function ht(e) {
	var t, n = W, r = e.parent;
	if (!zn && r !== null && e.v !== T && r.f & 24576) return be(), e.v;
	Un(r);
	try {
		mt(e), t = rr(e);
	} finally {
		Un(n);
	}
	return t;
}
function gt(e) {
	var t = ht(e);
	if (!e.equals(t) && (e.wv = er(), (!F?.is_fork || e.deps === null) && (F === null ? e.v = t : (F.capture(e, t, !0), bt?.capture(e, t, !0)), e.deps === null))) {
		N(e, g);
		return;
	}
	zn || (xt === null ? Qe(e) : (hn() || F?.is_fork) && xt.set(e, t));
}
function _t(e) {
	if (e.effects !== null) for (let t of e.effects) (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && it(() => {
		t.ac.abort(he), t.ac = null;
	}), t.fn !== null && (t.teardown = d), or(t, 0), Dn(t));
}
function vt(e) {
	if (e.effects !== null) for (let t of e.effects) t.teardown && t.fn !== null && sr(t);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/batch.js
var yt = null, F = null, bt = null, xt = null, St = null, Ct = !1, wt = !1, Tt = null, Et = null, Dt = 0, Ot = 1, kt = class e {
	id = Ot++;
	#e = !1;
	linked = !0;
	#t = null;
	#n = null;
	async_deriveds = /* @__PURE__ */ new Map();
	current = /* @__PURE__ */ new Map();
	previous = /* @__PURE__ */ new Map();
	#r = /* @__PURE__ */ new Set();
	#i = /* @__PURE__ */ new Set();
	#a = 0;
	#o = /* @__PURE__ */ new Map();
	#s = null;
	#c = [];
	#l = [];
	#u = /* @__PURE__ */ new Set();
	#d = /* @__PURE__ */ new Set();
	#f = /* @__PURE__ */ new Map();
	#p = /* @__PURE__ */ new Set();
	is_fork = !1;
	#m = !1;
	constructor() {
		yt === null ? yt = this : (yt.#n = this, this.#t = yt), yt = this;
	}
	#h() {
		if (this.is_fork) return !0;
		for (let n of this.#o.keys()) {
			for (var e = n, t = !1; e.parent !== null;) {
				if (this.#f.has(e)) {
					t = !0;
					break;
				}
				e = e.parent;
			}
			if (!t) return !0;
		}
		return !1;
	}
	skip_effect(e) {
		this.#f.has(e) || this.#f.set(e, {
			d: [],
			m: []
		}), this.#p.delete(e);
	}
	unskip_effect(e, t = (e) => this.schedule(e)) {
		var n = this.#f.get(e);
		if (n) {
			this.#f.delete(e);
			for (var r of n.d) N(r, _), t(r);
			for (r of n.m) N(r, v), t(r);
		}
		this.#p.add(e);
	}
	#g() {
		var e = [];
		for (let i of this.#c) if (!(i.f & 16384 || !(i.f & 6144))) {
			for (var t = i, n = !1; t.parent !== null;) {
				t = t.parent;
				var r = t.f;
				if (r & 96) {
					if (!(r & 1024)) {
						n = !0;
						break;
					}
					t.f ^= g;
				}
			}
			n || e.push(t);
		}
		return this.#c = [], e;
	}
	#_() {
		this.#e = !0;
		for (let e of this.#u) this.#d.delete(e), N(e, _), this.schedule(e);
		for (let e of this.#d) N(e, v), this.schedule(e);
		this.apply();
		for (var t = Tt = [], n = [], r = Et = []; this.#c.length > 0;) {
			Dt++ > 1e3 && (this.#S(), jt());
			for (let e of this.#g()) try {
				this.#v(e, t, n);
			} catch (t) {
				throw It(e), this.#h() || this.discard(), t;
			}
		}
		if (F = null, r.length > 0) {
			var i = e.ensure();
			for (let e of r) i.schedule(e);
		}
		if (Tt = null, Et = null, this.#h()) {
			this.#x(n), this.#x(t);
			for (let [e, t] of this.#f) Ft(e, t);
			r.length > 0 && F.#_();
			return;
		}
		let a = this.#y();
		if (a) {
			this.#x(n), this.#x(t), a.#b(this);
			return;
		}
		this.#u.clear(), this.#d.clear();
		for (let e of this.#r) e(this);
		this.#r.clear(), bt = this, Nt(n), Nt(t), bt = null, this.#s?.resolve();
		var o = F;
		if (this.#a === 0 && (this.#c.length === 0 || o !== null) && this.#S(), this.#c.length > 0) {
			if (o !== null) {
				for (let e of this.#c) o.#c.push(e);
				this.#c = [];
			} else o = this;
		}
		o !== null && (Rt.clear(), o.#_());
	}
	#v(e, t, n) {
		e.f ^= g;
		for (var r = e.first; r !== null;) {
			var i = r.f, a = !!(i & 96);
			if (!(a && i & 1024 || i & 8192 || this.#f.has(r)) && r.fn !== null) {
				a ? r.f ^= g : i & 4 ? t.push(r) : tr(r) && (i & 16 && this.#d.add(r), sr(r));
				var o = r.first;
				if (o !== null) {
					r = o;
					continue;
				}
			}
			for (; r !== null;) {
				var s = r.next;
				if (s !== null) {
					r = s;
					break;
				}
				r = r.parent;
			}
		}
	}
	#y() {
		for (var e = this.#t; e !== null;) {
			if (!e.is_fork) {
				for (let [t, [, n]] of this.current) if (e.current.has(t) && !n) return e;
			}
			e = e.#t;
		}
		return null;
	}
	#b(e) {
		for (let [t, n] of e.current) !this.previous.has(t) && e.previous.has(t) && this.previous.set(t, e.previous.get(t)), this.current.set(t, n);
		for (let [t, n] of e.async_deriveds) {
			let e = this.async_deriveds.get(t);
			e && n.promise.then(e.resolve).catch(e.reject);
		}
		e.async_deriveds.clear(), this.transfer_effects(e.#u, e.#d);
		let t = (e) => {
			var n = e.reactions;
			if (n !== null && !(e.f & 2 && !(e.f & 6144))) for (let e of n) {
				var r = e.f;
				if (r & 2) t(e);
				else {
					var i = e;
					r & 4194320 && !this.async_deriveds.has(i) && (this.#d.delete(i), N(i, _), this.schedule(i));
				}
			}
		};
		for (let e of this.current.keys()) t(e);
		this.oncommit(() => e.discard()), e.#S(), F = this, this.#_();
	}
	#x(e) {
		for (var t = 0; t < e.length; t += 1) $e(e[t], this.#u, this.#d);
	}
	capture(e, t, n = !1) {
		e.v !== T && !this.previous.has(e) && this.previous.set(e, e.v), e.f & 8388608 || (this.current.set(e, [t, n]), xt?.set(e, t)), this.is_fork || (e.v = t);
	}
	activate() {
		F = this;
	}
	deactivate() {
		F = null, xt = null;
	}
	flush() {
		try {
			wt = !0, F = this, this.#_();
		} finally {
			Dt = 0, St = null, Tt = null, Et = null, wt = !1, F = null, xt = null, Rt.clear();
		}
	}
	discard() {
		for (let e of this.#i) e(this);
		this.#i.clear();
		for (let e of this.async_deriveds.values()) e.reject(dt);
		this.#S(), this.#s?.resolve();
	}
	register_created_effect(e) {
		this.#l.push(e);
	}
	increment(e, t) {
		if (this.#a += 1, e) {
			let e = this.#o.get(t) ?? 0;
			this.#o.set(t, e + 1);
		}
	}
	decrement(e, t) {
		if (--this.#a, e) {
			let e = this.#o.get(t) ?? 0;
			e === 1 ? this.#o.delete(t) : this.#o.set(t, e - 1);
		}
		this.#m || (this.#m = !0, M(() => {
			this.#m = !1, this.linked && this.flush();
		}));
	}
	transfer_effects(e, t) {
		for (let t of e) this.#u.add(t);
		for (let e of t) this.#d.add(e);
		e.clear(), t.clear();
	}
	oncommit(e) {
		this.#r.add(e);
	}
	ondiscard(e) {
		this.#i.add(e);
	}
	settled() {
		return (this.#s ??= p()).promise;
	}
	static ensure() {
		if (F === null) {
			let t = F = new e();
			!wt && !Ct && M(() => {
				t.#e || t.flush();
			});
		}
		return F;
	}
	apply() {
		xt = null;
	}
	schedule(e) {
		if (St = e, e.b?.is_pending && e.f & 16777228 && !(e.f & 32768)) {
			e.b.defer_effect(e);
			return;
		}
		this.#c.push(e);
	}
	#S() {
		if (this.linked) {
			var e = this.#t, t = this.#n;
			e === null || (e.#n = t), t === null ? yt = e : t.#t = e, this.linked = !1;
		}
	}
};
function At(e) {
	var t = Ct;
	Ct = !0;
	try {
		var n;
		for (e && (F !== null && !F.is_fork && F.flush(), n = e());;) {
			if (Xe(), F === null) return n;
			F.flush();
		}
	} finally {
		Ct = t;
	}
}
function jt() {
	try {
		Le();
	} catch (e) {
		dn(e, St);
	}
}
var Mt = null;
function Nt(e) {
	var t = e.length;
	if (t !== 0) {
		for (var n = 0; n < t;) {
			var r = e[n++];
			if (!(r.f & 24576) && tr(r) && (Mt = /* @__PURE__ */ new Set(), sr(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && jn(r), Mt?.size > 0)) {
				Rt.clear();
				for (let e of Mt) {
					if (e.f & 24576) continue;
					let t = [e], n = e.parent;
					for (; n !== null;) Mt.has(n) && (Mt.delete(n), t.push(n)), n = n.parent;
					for (let e = t.length - 1; e >= 0; e--) {
						let n = t[e];
						n.f & 24576 || sr(n);
					}
				}
				Mt.clear();
			}
		}
		Mt = null;
	}
}
function Pt(e) {
	F.schedule(e);
}
function Ft(e, t) {
	if (!(e.f & 32 && e.f & 1024)) {
		e.f & 2048 ? t.d.push(e) : e.f & 4096 && t.m.push(e), N(e, g);
		for (var n = e.first; n !== null;) Ft(n, t), n = n.next;
	}
}
function It(e) {
	N(e, g);
	for (var t = e.first; t !== null;) It(t), t = t.next;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/sources.js
var Lt = /* @__PURE__ */ new Set(), Rt = /* @__PURE__ */ new Map(), zt = !1;
function Bt(e, t) {
	return {
		f: 0,
		v: e,
		reactions: null,
		equals: ke,
		rv: 0,
		wv: 0
	};
}
/*#__NO_SIDE_EFFECTS__*/
function I(e, t) {
	let n = Bt(e, t);
	return Gn(n), n;
}
/*#__NO_SIDE_EFFECTS__*/
function Vt(e, t = !1, n = !0) {
	let r = Bt(e);
	return t || (r.equals = je), r;
}
function L(e, t, n = !1) {
	return U !== null && (!Vn || U.f & 131072) && qe() && U.f & 4325394 && (Wn === null || !Wn.has(e)) && Ve(), Wt(e, n ? R(t) : t, Et);
}
var Ht = null, Ut = 0;
function Wt(e, t, n = null) {
	if (!e.equals(t)) {
		zn ? Rt.set(e, t) : Rt.has(e) || Rt.set(e, e.v);
		var r = kt.ensure();
		if (r.capture(e, t), e.f & 2) {
			let t = e;
			e.f & 2048 && ht(t), xt === null && Qe(t);
		}
		e.wv = er(), Ht = null, Ut = 0, qt(e, _, n), Ht = null, qe() && W !== null && W.f & 1024 && !(W.f & 96) && (Jn === null ? Yn([e]) : Jn.push(e)), !r.is_fork && Lt.size > 0 && !zt && Gt();
	}
	return t;
}
function Gt() {
	zt = !1;
	for (let e of Lt) {
		e.f & 1024 && N(e, v);
		let t;
		try {
			t = tr(e);
		} catch {
			t = !0;
		}
		t && sr(e);
	}
	Lt.clear();
}
function Kt(e) {
	L(e, e.v + 1);
}
function qt(e, t, n) {
	var r = e.reactions;
	if (r !== null) {
		var i = qe(), a = r.length;
		if (Ut += a, Ut > 1e5 && Ht === null && (Ht = /* @__PURE__ */ new Set()), Ht !== null) {
			if (Ht.has(e)) return;
			Ht.add(e);
		}
		for (var o = 0; o < a; o++) {
			var s = r[o], c = s.f;
			if (i || s !== W) {
				var l = (c & _) === 0;
				if (l && N(s, t), c & 131072) Lt.add(s);
				else if (c & 2) {
					var u = s;
					xt?.delete(u), qt(u, v, n);
				} else if (l) {
					var d = s;
					c & 16 && Mt !== null && Mt.add(d), n === null ? Pt(d) : n.push(d);
				}
			}
		}
	}
}
function R(t) {
	if (typeof t != "object" || !t || se in t || ce in t) return t;
	let n = l(t);
	if (n !== s && n !== c) return t;
	var r = /* @__PURE__ */ new Map(), i = e(t), o = /* @__PURE__ */ I(0), u = null, d = Qn, f = (e) => {
		if (Qn === d) return e();
		var t = U, n = Qn;
		Hn(null), $n(d);
		var r = e();
		return Hn(t), $n(n), r;
	};
	return i && r.set("length", /* @__PURE__ */ I(t.length, u)), new Proxy(t, {
		defineProperty(e, t, n) {
			(!("value" in n) || n.configurable === !1 || n.enumerable === !1 || n.writable === !1) && ze();
			var i = r.get(t);
			return i === void 0 ? f(() => {
				var e = /* @__PURE__ */ I(n.value, u);
				return r.set(t, e), e;
			}) : L(i, n.value, !0), !0;
		},
		deleteProperty(e, t) {
			var n = r.get(t);
			if (n === void 0) {
				if (t in e) {
					let e = f(() => /* @__PURE__ */ I(T, u));
					r.set(t, e), Kt(o);
				}
			} else L(n, T), Kt(o);
			return !0;
		},
		get(e, n, i) {
			if (n === se) return t;
			var o = r.get(n), s = n in e;
			if (o === void 0 && (!s || a(e, n)?.writable) && (o = f(() => /* @__PURE__ */ I(R(s ? e[n] : T), u)), r.set(n, o)), o !== void 0) {
				var c = G(o);
				return c === T ? void 0 : c;
			}
			return Reflect.get(e, n, i);
		},
		getOwnPropertyDescriptor(e, t) {
			this.has?.(e, t);
			var n = Reflect.getOwnPropertyDescriptor(e, t), i = r.get(t);
			if (i !== void 0) {
				var a = G(i);
				if (a === T) return;
				if (n && "value" in n) n.value = a;
				else return {
					enumerable: !0,
					configurable: !0,
					value: a,
					writable: !0
				};
			}
			return n;
		},
		has(e, t) {
			if (t === se) return !0;
			var n = r.get(t), i = n !== void 0 && n.v !== T || Reflect.has(e, t);
			return (n !== void 0 || W !== null && (!i || a(e, t)?.writable)) && (n === void 0 && (n = f(() => /* @__PURE__ */ I(i ? R(e[t]) : T, u)), r.set(t, n)), G(n) === T) ? !1 : i;
		},
		set(e, t, n, s) {
			var c = r.get(t), l = t in e;
			if (i && t === "length") for (var d = n; d < c.v; d += 1) {
				var p = r.get(d + "");
				p === void 0 ? d in e && (p = f(() => /* @__PURE__ */ I(T, u)), r.set(d + "", p)) : L(p, T);
			}
			if (c === void 0) (!l || a(e, t)?.writable) && (c = f(() => /* @__PURE__ */ I(void 0, u)), L(c, R(n)), r.set(t, c));
			else {
				l = c.v !== T;
				var m = f(() => R(n));
				L(c, m);
			}
			var h = Reflect.getOwnPropertyDescriptor(e, t);
			if (h?.set && h.set.call(s, n), !l) {
				if (i && typeof t == "string") {
					var g = r.get("length"), _ = Number(t);
					Number.isInteger(_) && _ >= g.v && L(g, _ + 1);
				}
				Kt(o);
			}
			return !0;
		},
		ownKeys(e) {
			G(o);
			var t = Reflect.ownKeys(e).filter((e) => {
				var t = r.get(e);
				return t === void 0 || t.v !== T;
			});
			for (var [n, i] of r) i.v !== T && !(n in e) && t.push(n);
			return t;
		},
		setPrototypeOf() {
			Be();
		}
	});
}
function Jt(e) {
	try {
		if (typeof e == "object" && e && se in e) return e[se];
	} catch {}
	return e;
}
function Yt(e, t) {
	return Object.is(Jt(e), Jt(t));
}
var Xt, Zt, Qt, $t;
function en() {
	if (Xt === void 0) {
		Xt = window, Zt = /Firefox/.test(navigator.userAgent);
		var e = Element.prototype, t = Node.prototype, n = Text.prototype;
		Qt = a(t, "firstChild").get, $t = a(t, "nextSibling").get, u(e) && (e[fe] = void 0, e[de] = null, e[pe] = void 0, e.__e = void 0), u(n) && (n[me] = void 0);
	}
}
function tn(e = "") {
	return document.createTextNode(e);
}
/*@__NO_SIDE_EFFECTS__*/
function nn(e) {
	return Qt.call(e);
}
/*@__NO_SIDE_EFFECTS__*/
function rn(e) {
	return $t.call(e);
}
function z(e, t) {
	if (!D) return /* @__PURE__ */ nn(e);
	var n = /* @__PURE__ */ nn(O);
	if (n === null) n = O.appendChild(tn());
	else if (t && n.nodeType !== 3) {
		var r = tn();
		return n?.before(r), we(r), r;
	}
	return t && ln(n), we(n), n;
}
function an(e, t = !1) {
	if (!D) {
		var n = /* @__PURE__ */ nn(e);
		return n instanceof Comment && n.data === "" ? /* @__PURE__ */ rn(n) : n;
	}
	if (t) {
		if (O?.nodeType !== 3) {
			var r = tn();
			return O?.before(r), we(r), r;
		}
		ln(O);
	}
	return O;
}
function B(e, t = !1) {
	if (!D) return /* @__PURE__ */ nn(e);
	var n = z(e, t);
	return k(e), n;
}
function V(e, t = 1, n = !1) {
	let r = D ? O : e;
	for (var i; t--;) i = r, r = /* @__PURE__ */ rn(r);
	if (!D) return r;
	if (n) {
		if (r?.nodeType !== 3) {
			var a = tn();
			return r === null ? i?.after(a) : r.before(a), we(a), a;
		}
		ln(r);
	}
	return we(r), r;
}
function on(e) {
	e.textContent = "";
}
function sn() {
	return !1;
}
function cn(e, t, n) {
	return t == null || t === "http://www.w3.org/1999/xhtml" ? n ? document.createElement(e, { is: n }) : document.createElement(e) : n ? document.createElementNS(t, e, { is: n }) : document.createElementNS(t, e);
}
function ln(e) {
	if (e.nodeValue.length < 65536) return;
	let t = e.nextSibling;
	for (; t !== null && t.nodeType === 3;) t.remove(), e.nodeValue += t.nodeValue, t = e.nextSibling;
}
function un(e) {
	var t = W;
	if (t === null) return U.f |= oe, e;
	if (!(t.f & 32768) && !(t.f & 4)) throw e;
	dn(e, t);
}
function dn(e, t) {
	if (!(t !== null && t.f & 16384)) {
		for (; t !== null;) {
			if (t.f & 128 && !(t.f & 33570816)) {
				if (!(t.f & 32768)) throw e;
				try {
					t.b.error(e);
					return;
				} catch (t) {
					e = t;
				}
			}
			t = t.parent;
		}
		throw e;
	}
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/effects.js
function fn(e) {
	W === null && (U === null && Ie(e), Fe()), zn && A(e);
}
function pn(e, t) {
	var n = t.last;
	n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function mn(e, t) {
	var n = W;
	n !== null && n.f & 8192 && (e |= y);
	var r = {
		ctx: j,
		deps: null,
		nodes: null,
		f: e | _ | 512,
		first: null,
		fn: t,
		last: null,
		next: null,
		parent: n,
		b: n && n.b,
		prev: null,
		teardown: null,
		wv: 0,
		ac: null
	};
	F?.register_created_effect(r);
	var i = r;
	if (e & 4) Tt === null ? kt.ensure().schedule(r) : Tt.push(r);
	else if (t !== null) {
		try {
			sr(r);
		} catch (e) {
			throw kn(r), e;
		}
		i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && !(i.f & 524288) && (i = i.first, e & 16 && e & 65536 && i !== null && (i.f |= ee));
	}
	if (i !== null && (i.parent = n, n !== null && pn(i, n), U !== null && U.f & 2 && !(e & 64))) {
		var a = U;
		(a.effects ??= []).push(i);
	}
	return r;
}
function hn() {
	return U !== null && !Vn;
}
function gn(e) {
	let t = mn(8, null);
	return N(t, g), t.teardown = e, t;
}
function _n(e) {
	fn("$effect");
	var t = W.f;
	if (!U && t & 32 && j !== null && !j.i) {
		var n = j;
		(n.e ??= []).push(e);
	} else return vn(e);
}
function vn(e) {
	return mn(4 | ne, e);
}
function yn(e) {
	kt.ensure();
	let t = mn(64 | te, e);
	return (e = {}) => new Promise((n) => {
		e.outro ? Mn(t, () => {
			kn(t), n(void 0);
		}) : (kn(t), n(void 0));
	});
}
function bn(e) {
	return mn(4, e);
}
function xn(e) {
	return mn(ae | te, e);
}
function Sn(e, t = 0) {
	return mn(8 | t, e);
}
function H(e, t = [], n = [], r = []) {
	ot(r, t, n, (t) => {
		mn(8, () => {
			e(...t.map(G));
		});
	});
}
function Cn(e, t = 0) {
	return mn(16 | t, e);
}
function wn(e, t = 0) {
	return mn(h | t, e);
}
function Tn(e) {
	return mn(32 | te, e);
}
function En(e) {
	var t = e.teardown;
	if (t !== null) {
		let n = zn, r = U;
		Bn(!0), Hn(null);
		try {
			t.call(null);
		} catch (t) {
			dn(t, e.parent);
		} finally {
			Bn(n), Hn(r);
		}
	}
}
function Dn(e, t = !1) {
	var n = e.first;
	for (e.first = e.last = null; n !== null;) {
		let e = n.ac;
		e !== null && it(() => {
			e.abort(he);
		});
		var r = n.next;
		n.f & 64 ? n.parent = null : kn(n, t), n = r;
	}
}
function On(e) {
	for (var t = e.first; t !== null;) {
		var n = t.next;
		t.f & 32 || kn(t), t = n;
	}
}
function kn(e, t = !0) {
	var n = !1;
	(t || e.f & 262144) && e.nodes !== null && e.nodes.end !== null && (An(e.nodes.start, e.nodes.end), n = !0), e.f |= S, Dn(e, t && !n), or(e, 0);
	var r = e.nodes && e.nodes.t;
	if (r !== null) for (let e of r) e.stop();
	En(e), e.f ^= S, e.f |= b;
	var i = e.parent;
	i !== null && i.first !== null && jn(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function An(e, t) {
	for (; e !== null;) {
		var n = e === t ? null : /* @__PURE__ */ rn(e);
		e.remove(), e = n;
	}
}
function jn(e) {
	var t = e.parent, n = e.prev, r = e.next;
	n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Mn(e, t, n = !0) {
	var r = [];
	e.f |= 256, Nn(e, r, !0);
	var i = () => {
		n && kn(e), t && t();
	}, a = r.length;
	if (a > 0) {
		var o = () => --a || i();
		for (var s of r) s.out(o);
	} else i();
}
function Nn(e, t, n) {
	if (!(e.f & 8192)) {
		e.f ^= y;
		var r = e.nodes && e.nodes.t;
		if (r !== null) for (let e of r) (e.is_global || n) && t.push(e);
		for (var i = e.first; i !== null;) {
			var a = i.next;
			if (!(i.f & 64)) {
				var o = !!(i.f & 65536) || !!(i.f & 32) && !!(e.f & 16);
				Nn(i, t, o ? n : !1);
			}
			i = a;
		}
	}
}
function Pn(e) {
	e.f &= -257, Fn(e, !0);
}
function Fn(e, t) {
	if (!(e.f & 256) && e.f & 8192) {
		e.f ^= y, e.f & 1024 || (N(e, _), kt.ensure().schedule(e));
		for (var n = e.first; n !== null;) {
			var r = n.next, i = !!(n.f & 65536) || !!(n.f & 32);
			Fn(n, i ? t : !1), n = r;
		}
		var a = e.nodes && e.nodes.t;
		if (a !== null) for (let e of a) (e.is_global || t) && e.in();
	}
}
function In(e, t) {
	if (e.nodes) for (var n = e.nodes.start, r = e.nodes.end; n !== null;) {
		var i = n === r ? null : /* @__PURE__ */ rn(n);
		t.append(n), n = i;
	}
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/legacy.js
var Ln = null, Rn = !1, zn = !1;
function Bn(e) {
	zn = e;
}
var U = null, Vn = !1;
function Hn(e) {
	U = e;
}
var W = null;
function Un(e) {
	W = e;
}
var Wn = null;
function Gn(e) {
	U !== null && (U.f & 2097152 || U.f & 2) && (Wn ??= /* @__PURE__ */ new Set()).add(e);
}
var Kn = null, qn = 0, Jn = null;
function Yn(e) {
	Jn = e;
}
var Xn = 1, Zn = 0, Qn = Zn;
function $n(e) {
	Qn = e;
}
function er() {
	return ++Xn;
}
function tr(e) {
	var t = e.f;
	if (t & 2048) return !0;
	if (t & 4096) {
		for (var n = e.deps, r = n.length, i = 0; i < r; i++) {
			var a = n[i];
			if (tr(a) && gt(a), a.wv > e.wv) return !0;
		}
		t & 512 && xt === null && N(e, g);
	}
	return !1;
}
function nr(e, t, n = !0) {
	var r = e.reactions;
	if (r !== null && !(Wn !== null && Wn.has(e))) for (var i = 0; i < r.length; i++) {
		var a = r[i];
		a.f & 2 ? nr(a, t, !1) : t === a && (n ? N(a, _) : a.f & 1024 && N(a, v), Pt(a));
	}
}
function rr(e) {
	var t = Kn, n = qn, r = Jn, i = U, a = Wn, o = j, s = Vn, c = Qn, l = e.f;
	Kn = null, qn = 0, Jn = null, U = l & 96 ? null : e, Wn = null, Ue(e.ctx), Vn = !1, Qn = ++Zn, e.ac !== null && (it(() => {
		e.ac.abort(he);
	}), e.ac = null);
	try {
		e.f |= ie;
		var u = e.fn, d = u();
		e.f |= x;
		var f = ir(e);
		if (qe() && Jn !== null && !Vn && f !== null && !(e.f & 6146)) for (var p = 0; p < Jn.length; p++) nr(Jn[p], e);
		if (i !== null && i !== e) {
			if (Zn++, i.deps !== null) for (let e = 0; e < n; e += 1) i.deps[e].rv = Zn;
			if (t !== null) for (let e of t) e.rv = Zn;
			Jn !== null && (r === null ? r = Jn : r.push(...Jn));
		}
		return e.f & 8388608 && (e.f ^= oe), d;
	} catch (t) {
		return ir(e), un(t);
	} finally {
		e.f ^= ie, Kn = t, qn = n, Jn = r, U = i, Wn = a, Ue(o), Vn = s, Qn = c;
	}
}
function ir(e) {
	var t = e.deps, n = F?.is_fork;
	if (Kn !== null) {
		var r;
		if (n || or(e, qn), t !== null && qn > 0) for (t.length = qn + Kn.length, r = 0; r < Kn.length; r++) t[qn + r] = Kn[r];
		else e.deps = t = Kn;
		if (hn() && e.f & 512) for (r = qn; r < t.length; r++) (t[r].reactions ??= []).push(e);
	} else !n && t !== null && qn < t.length && (or(e, qn), t.length = qn);
	return t;
}
function ar(e, r) {
	let i = r.reactions;
	if (i !== null) {
		var a = t.call(i, e);
		if (a !== -1) {
			var o = i.length - 1;
			o === 0 ? i = r.reactions = null : (i[a] = i[o], i.pop());
		}
	}
	if (i === null && r.f & 2 && (Kn === null || !n.call(Kn, r))) {
		var s = r;
		s.f & 512 && (s.f ^= 512), s.v !== T && Qe(s), s.ac !== null && it(() => {
			s.ac.abort(he), s.ac = null, N(s, _);
		}), _t(s), or(s, 0);
	}
}
function or(e, t) {
	var n = e.deps;
	if (n !== null) for (var r = t; r < n.length; r++) ar(e, n[r]);
}
function sr(e) {
	var t = e.f;
	if (!(t & 16384)) {
		N(e, g);
		var n = W, r = Rn;
		W = e, Rn = !(t & 96);
		try {
			t & 16777232 ? On(e) : Dn(e), En(e);
			var i = rr(e);
			e.teardown = typeof i == "function" ? i : null, e.wv = Xn;
		} finally {
			Rn = r, W = n;
		}
	}
}
async function cr() {
	await Promise.resolve(), At();
}
function G(e) {
	var t = !!(e.f & 2);
	if (Ln?.add(e), U !== null && !Vn && !(W !== null && W.f & 16384) && (Wn === null || !Wn.has(e))) {
		var r = U.deps;
		if (U.f & 2097152) e.rv < Zn && (e.rv = Zn, Kn === null && r !== null && r[qn] === e ? qn++ : Kn === null ? Kn = [e] : Kn.push(e));
		else {
			U.deps ??= [], n.call(U.deps, e) || U.deps.push(e);
			var i = e.reactions;
			i === null ? e.reactions = [U] : n.call(i, U) || i.push(U);
		}
	}
	if (zn && Rt.has(e)) return Rt.get(e);
	if (t) {
		var a = e;
		if (zn) {
			var o = a.v;
			return (!(a.f & 1024) && a.reactions !== null || ur(a)) && (o = ht(a)), Rt.set(a, o), o;
		}
		var s = !(a.f & 512) && !Vn && U !== null && (Rn || !!(U.f & 512)), c = (a.f & x) === 0;
		tr(a) && (s && (a.f |= 512), gt(a)), s && !c && (vt(a), lr(a));
	}
	if (xt?.has(e)) return xt.get(e);
	if (e.f & 8388608) throw e.v;
	return e.v;
}
function lr(e) {
	if (e.f |= 512, e.deps !== null) for (let t of e.deps) (t.reactions ??= []).push(e), t.f & 2 && !(t.f & 512) && (vt(t), lr(t));
}
function ur(e) {
	if (e.v === T) return !0;
	if (e.deps === null) return !1;
	for (let t of e.deps) if (Rt.has(t) || t.f & 2 && ur(t)) return !0;
	return !1;
}
function dr(e) {
	var t = Vn;
	try {
		return Vn = !0, e();
	} finally {
		Vn = t;
	}
}
function fr(e) {
	if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
		if (se in e) pr(e);
		else if (!Array.isArray(e)) for (let t in e) {
			let n = e[t];
			typeof n == "object" && n && se in n && pr(n);
		}
	}
}
function pr(e, t = /* @__PURE__ */ new Set()) {
	if (typeof e == "object" && e && !(e instanceof EventTarget) && !t.has(e)) {
		t.add(e), e instanceof Date && e.getTime();
		for (let n in e) try {
			pr(e[n], t);
		} catch {}
		let n = l(e);
		if (n !== Object.prototype && n !== Array.prototype && n !== Map.prototype && n !== Set.prototype && n !== Date.prototype) {
			let t = o(n);
			for (let n in t) {
				let r = t[n].get;
				if (r) try {
					r.call(e);
				} catch {}
			}
		}
	}
}
function mr(e) {
	return e.endsWith("capture") && e !== "gotpointercapture" && e !== "lostpointercapture";
}
var hr = [
	"beforeinput",
	"click",
	"change",
	"dblclick",
	"contextmenu",
	"focusin",
	"focusout",
	"input",
	"keydown",
	"keyup",
	"mousedown",
	"mousemove",
	"mouseout",
	"mouseover",
	"mouseup",
	"pointerdown",
	"pointermove",
	"pointerout",
	"pointerover",
	"pointerup",
	"touchend",
	"touchmove",
	"touchstart"
];
function gr(e) {
	return hr.includes(e);
}
var _r = /* @__PURE__ */ "allowfullscreen.async.autofocus.autoplay.checked.controls.default.disabled.formnovalidate.indeterminate.inert.ismap.loop.multiple.muted.nomodule.novalidate.open.playsinline.readonly.required.reversed.seamless.selected.webkitdirectory.defer.disablepictureinpicture.disableremoteplayback".split("."), vr = {
	formnovalidate: "formNoValidate",
	ismap: "isMap",
	nomodule: "noModule",
	playsinline: "playsInline",
	readonly: "readOnly",
	defaultvalue: "defaultValue",
	defaultchecked: "defaultChecked",
	srcobject: "srcObject",
	novalidate: "noValidate",
	allowfullscreen: "allowFullscreen",
	disablepictureinpicture: "disablePictureInPicture",
	disableremoteplayback: "disableRemotePlayback"
};
function yr(e) {
	return e = e.toLowerCase(), vr[e] ?? e;
}
[..._r];
var br = ["touchstart", "touchmove"];
function xr(e) {
	return br.includes(e);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dev/css.js
var Sr = Symbol("events"), Cr = /* @__PURE__ */ new Set(), wr = /* @__PURE__ */ new Set();
function Tr(e, t, n, r = {}) {
	function i(e) {
		if (r.capture || Ar.call(t, e), !e.cancelBubble) return it(() => n?.call(this, e));
	}
	return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? (i.__removed = !1, M(() => {
		i.__removed || t.addEventListener(e, i, r);
	})) : t.addEventListener(e, i, r), i;
}
function Er(e, t, n, r, i) {
	var a = {
		capture: r,
		passive: i
	}, o = Tr(e, t, n, a);
	(t === document.body || t === window || t === document || t instanceof HTMLMediaElement) && gn(() => {
		o.__removed = !0, t.removeEventListener(e, o, a);
	});
}
function K(e, t, n) {
	(t[Sr] ??= {})[e] = n;
}
function Dr(e) {
	for (var t = 0; t < e.length; t++) Cr.add(e[t]);
	for (var n of wr) n(e);
}
var Or = null, kr = !1;
function Ar(e) {
	var t = this, n = t.ownerDocument, r = e.type, a = e.composedPath?.() || [], o = a[0] || e.target;
	Or = e, kr || (kr = !0, setTimeout(() => {
		kr = !1, Or = null;
	}));
	var s = 0, c = Or === e && e[Sr];
	if (c) {
		var l = a.indexOf(c);
		if (l !== -1 && (t === document || t === window)) {
			e[Sr] = t;
			return;
		}
		var u = a.indexOf(t);
		if (u === -1) return;
		l <= u && (s = l);
	}
	if (o = a[s] || e.target, o !== t) {
		i(e, "currentTarget", {
			configurable: !0,
			get() {
				return o || n;
			}
		});
		var d = U, f = W;
		Hn(null), Un(null);
		try {
			for (var p, m = []; o !== null && o !== t;) {
				try {
					var h = o[Sr]?.[r];
					h != null && (!o.disabled || e.target === o) && h.call(o, e);
				} catch (e) {
					p ? m.push(e) : p = e;
				}
				if (e.cancelBubble) break;
				s++, o = s < a.length ? a[s] : null;
			}
			if (p) {
				for (let e of m) queueMicrotask(() => {
					throw e;
				});
				throw p;
			}
		} finally {
			e[Sr] = t, delete e.currentTarget, Hn(d), Un(f);
		}
	}
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/reconciler.js
var jr = globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", { createHTML: (e) => e });
function Mr(e) {
	return jr?.createHTML(e) ?? e;
}
function Nr(e) {
	var t = cn("template");
	return t.innerHTML = Mr(e.replaceAll("<!>", "<!---->")), t.content;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/template.js
function Pr(e, t) {
	var n = W;
	n.nodes === null && (n.nodes = {
		start: e,
		end: t,
		a: null,
		t: null
	});
}
/*#__NO_SIDE_EFFECTS__*/
function q(e, t) {
	var n = !!(t & 1), r = !!(t & 2), i, a = !e.startsWith("<!>");
	return () => {
		if (D) return Pr(O, null), O;
		i === void 0 && (i = Nr(a ? e : "<!>" + e), n || (i = /* @__PURE__ */ nn(i)));
		var t = r || Zt ? document.importNode(i, !0) : i.cloneNode(!0);
		if (n) {
			var o = /* @__PURE__ */ nn(t), s = t.lastChild;
			Pr(o, s);
		} else Pr(t, t);
		return t;
	};
}
function Fr() {
	if (D) return Pr(O, null), O;
	var e = document.createDocumentFragment(), t = document.createComment(""), n = tn();
	return e.append(t, n), Pr(t, n), e;
}
function J(e, t) {
	if (D) {
		var n = W;
		(!(n.f & 32768) || n.nodes.end === null) && (n.nodes.end = O), Te();
		return;
	}
	e !== null && e.before(t);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/reactivity/create-subscriber.js
function Ir(e) {
	let t = 0, n = Bt(0), r;
	return () => {
		hn() && (G(n), Sn(() => (t === 0 && (r = dr(() => e(() => Kt(n)))), t += 1, () => {
			M(() => {
				--t, t === 0 && (r?.(), r = void 0, Kt(n));
			});
		})));
	};
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/blocks/boundary.js
var Lr = ee | te;
function Rr(e, t, n, r) {
	new zr(e, t, n, r);
}
var zr = class {
	parent;
	is_pending = !1;
	transform_error;
	#e;
	#t = D ? O : null;
	#n;
	#r;
	#i;
	#a = null;
	#o = null;
	#s = null;
	#c = null;
	#l = 0;
	#u = 0;
	#d = !1;
	#f = /* @__PURE__ */ new Set();
	#p = /* @__PURE__ */ new Set();
	#m = null;
	#h = Ir(() => (this.#m = Bt(this.#l), () => {
		this.#m = null;
	}));
	constructor(e, t, n, r) {
		this.#e = e, this.#n = t, this.#r = (e) => {
			var t = W;
			t.b = this, t.f |= 128, n(e);
		}, this.parent = W.b, this.transform_error = r ?? this.parent?.transform_error ?? ((e) => e), this.#i = Cn(() => {
			if (D) {
				let e = this.#t;
				Te();
				let t = e.data === "[!";
				if (e.data.startsWith("[?")) {
					let t = JSON.parse(e.data.slice(2));
					this.#_(t);
				} else t ? this.#y() : this.#g();
			} else this.#b();
		}, Lr), D && (this.#e = O);
	}
	#g() {
		try {
			this.#a = Tn(() => this.#r(this.#e));
		} catch (e) {
			this.error(e);
		}
	}
	#_(e) {
		let t = this.#n.failed, { reset: n, invoke_onerror: r } = this.#v(e);
		M(r), t && (this.#s = Tn(() => {
			t(this.#e, () => e, () => n);
		}));
	}
	#v(e) {
		var t = !1, n = !1;
		let r = () => {
			if (t) {
				Se();
				return;
			}
			t = !0, n && He(), this.#s !== null && Mn(this.#s, () => {
				this.#s = null;
			}), this.#S(() => {
				this.#b();
			});
		};
		return {
			reset: r,
			invoke_onerror: () => {
				try {
					n = !0, this.#n.onerror?.(e, r), n = !1;
				} catch (e) {
					dn(e, this.#i && this.#i.parent);
				}
			}
		};
	}
	#y() {
		let e = this.#n.pending;
		e && (this.is_pending = !0, this.#o = Tn(() => e(this.#e)), M(() => {
			var e = this.#c = document.createDocumentFragment(), t = tn(), n = !1;
			if (e.append(t), this.#a = this.#S(() => {
				try {
					return Tn(() => this.#r(t));
				} catch (e) {
					try {
						this.error(e), n = !0;
					} catch (e) {
						dn(e, this.#i.parent);
					}
					return null;
				}
			}), this.#a === null) {
				this.#c = null, n && this.#x(F);
				return;
			}
			this.#u === 0 && (this.#e.before(e), this.#c = null, Mn(this.#o, () => {
				this.#o = null;
			}), this.#x(F));
		}));
	}
	#b() {
		try {
			if (this.is_pending = this.has_pending_snippet(), this.#u = 0, this.#l = 0, this.#a = Tn(() => {
				this.#r(this.#e);
			}), this.#u > 0) {
				var e = this.#c = document.createDocumentFragment();
				In(this.#a, e);
				let t = this.#n.pending;
				this.#o = Tn(() => t(this.#e));
			} else this.#x(F);
		} catch (e) {
			this.error(e);
		}
	}
	#x(e) {
		this.is_pending = !1, e.transfer_effects(this.#f, this.#p);
	}
	defer_effect(e) {
		$e(e, this.#f, this.#p);
	}
	is_rendered() {
		return !this.is_pending && (!this.parent || this.parent.is_rendered());
	}
	has_pending_snippet() {
		return !!this.#n.pending;
	}
	#S(e) {
		var t = W, n = U, r = j;
		Un(this.#i), Hn(this.#i), Ue(this.#i.ctx);
		try {
			return kt.ensure(), e();
		} finally {
			Un(t), Hn(n), Ue(r);
		}
	}
	#C(e, t) {
		if (!this.has_pending_snippet()) {
			this.parent && this.parent.#C(e, t);
			return;
		}
		this.#u += e, this.#u === 0 && (this.#x(t), this.#o && Mn(this.#o, () => {
			this.#o = null;
		}), this.#c &&= (this.#e.before(this.#c), null));
	}
	update_pending_count(e, t) {
		this.#C(e, t), this.#l += e, !(!this.#m || this.#d) && (this.#d = !0, M(() => {
			this.#d = !1, this.#m && Wt(this.#m, this.#l);
		}));
	}
	get_effect_pending() {
		return this.#h(), G(this.#m);
	}
	error(e) {
		if (!this.#n.onerror && !this.#n.failed) throw e;
		F?.is_fork ? (this.#a && F.skip_effect(this.#a), this.#o && F.skip_effect(this.#o), this.#s && F.skip_effect(this.#s), F.oncommit(() => {
			this.#w(e);
		})) : this.#w(e);
	}
	#w(e) {
		this.#a &&= (kn(this.#a), null), this.#o &&= (kn(this.#o), null), this.#s &&= (kn(this.#s), null), D && (we(this.#t), Ee(), we(De()));
		let t = this.#n.failed, n = (e) => {
			let { reset: n, invoke_onerror: r } = this.#v(e);
			r(), t && (this.#s = this.#S(() => {
				try {
					return Tn(() => {
						var r = W;
						r.b = this, r.f |= 128, t(this.#e, () => e, () => n);
					});
				} catch (e) {
					return dn(e, this.#i.parent), null;
				}
			}));
		};
		M(() => {
			var t;
			try {
				t = this.transform_error(e);
			} catch (e) {
				dn(e, this.#i && this.#i.parent);
				return;
			}
			typeof t == "object" && t && typeof t.then == "function" ? t.then(n, (e) => dn(e, this.#i && this.#i.parent)) : n(t);
		});
	}
};
function Y(e, t) {
	var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
	n !== (e[me] ??= e.nodeValue) && (e[me] = n, e.nodeValue = `${n}`);
}
function Br(e, t) {
	return Hr(e, t);
}
var Vr = /* @__PURE__ */ new Map();
function Hr(e, { target: t, anchor: n, props: i = {}, events: a, context: o, intro: s = !0, transformError: c }) {
	en();
	var l = void 0, u = yn(() => {
		var s = n ?? t.appendChild(tn());
		Rr(s, { pending: () => {} }, (t) => {
			We({});
			var n = j;
			if (o && (n.c = o), a && (i.$$events = a), D && Pr(t, null), l = e(t, i) || Ke(), D && (W.nodes.end = O, O === null || O.nodeType !== 8 || O.data !== "]")) throw xe(), w;
			Ge();
		}, c);
		var u = /* @__PURE__ */ new Set(), d = (e) => {
			for (var n = 0; n < e.length; n++) {
				var r = e[n];
				if (!u.has(r)) {
					u.add(r);
					var i = xr(r);
					for (let e of [t, document]) {
						var a = Vr.get(e);
						a === void 0 && (a = /* @__PURE__ */ new Map(), Vr.set(e, a));
						var o = a.get(r);
						o === void 0 ? (e.addEventListener(r, Ar, { passive: i }), a.set(r, 1)) : a.set(r, o + 1);
					}
				}
			}
		};
		return d(r(Cr)), wr.add(d), () => {
			for (var e of u) for (let n of [t, document]) {
				var r = Vr.get(n), i = r.get(e);
				--i == 0 ? (n.removeEventListener(e, Ar), r.delete(e), r.size === 0 && Vr.delete(n)) : r.set(e, i);
			}
			wr.delete(d), s !== n && s.parentNode?.removeChild(s);
		};
	});
	return Ur.set(l, u), l;
}
var Ur = /* @__PURE__ */ new WeakMap();
function Wr(e, t) {
	let n = Ur.get(e);
	return n ? (Ur.delete(e), n(t)) : Promise.resolve();
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/blocks/branches.js
var Gr = class {
	anchor;
	#e = /* @__PURE__ */ new Map();
	#t = /* @__PURE__ */ new Map();
	#n = /* @__PURE__ */ new Map();
	#r = /* @__PURE__ */ new Set();
	#i = !0;
	constructor(e, t = !0) {
		this.anchor = e, this.#i = t;
	}
	#a = (e) => {
		if (this.#e.has(e)) {
			var t = this.#e.get(e), n = this.#t.get(t);
			if (n) Pn(n), this.#r.delete(t);
			else {
				var r = this.#n.get(t);
				r && (Pn(r.effect), this.#t.set(t, r.effect), this.#n.delete(t), r.fragment.lastChild.remove(), this.anchor.before(r.fragment), n = r.effect);
			}
			for (let [t, n] of this.#e) {
				if (this.#e.delete(t), t === e) break;
				let r = this.#n.get(n);
				r && (kn(r.effect), this.#n.delete(n));
			}
			for (let [e, r] of this.#t) {
				if (e === t || this.#r.has(e)) continue;
				let i = () => {
					if (Array.from(this.#e.values()).includes(e)) {
						var t = document.createDocumentFragment();
						In(r, t), t.append(tn()), this.#n.set(e, {
							effect: r,
							fragment: t
						});
					} else kn(r);
					this.#r.delete(e), this.#t.delete(e);
				};
				this.#i || !n ? (this.#r.add(e), Mn(r, i, !1)) : i();
			}
		}
	};
	#o = (e) => {
		this.#e.delete(e);
		let t = Array.from(this.#e.values());
		for (let [e, n] of this.#n) t.includes(e) || (kn(n.effect), this.#n.delete(e));
	};
	ensure(e, t) {
		var n = F, r = sn();
		if (t && !this.#t.has(e) && !this.#n.has(e)) {
			if (r) {
				var i = document.createDocumentFragment(), a = tn();
				i.append(a), this.#n.set(e, {
					effect: Tn(() => t(a)),
					fragment: i
				});
			} else this.#t.set(e, Tn(() => t(this.anchor)));
		}
		if (this.#e.set(n, e), r) {
			for (let [t, r] of this.#t) t === e ? n.unskip_effect(r) : n.skip_effect(r);
			for (let [t, r] of this.#n) t === e ? n.unskip_effect(r.effect) : n.skip_effect(r.effect);
			n.oncommit(this.#a), n.ondiscard(this.#o);
		} else D && (this.anchor = O), this.#a(n);
	}
};
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/blocks/if.js
function X(e, t, n = !1) {
	var r;
	D && (r = O, Te());
	var i = new Gr(e), a = n ? ee : 0;
	function o(e, t) {
		if (D) {
			var n = Oe(r);
			if (e !== parseInt(n.substring(1))) {
				var a = De();
				we(a), i.anchor = a, Ce(!1), i.ensure(e, t), Ce(!0);
				return;
			}
		}
		i.ensure(e, t);
	}
	Cn(() => {
		var e = !1;
		t((t, n = 0) => {
			e = !0, o(n, t);
		}), e || o(-1, null);
	}, a);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/blocks/key.js
var Kr = Symbol("NaN");
function qr(e, t, n) {
	D && Te();
	var r = new Gr(e), i = !qe();
	Cn(() => {
		var e = t();
		e !== e && (e = Kr), i && typeof e == "object" && e && (e = {}), r.ensure(e, n);
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/blocks/each.js
function Jr(e, t) {
	return t;
}
function Yr(e, t, n) {
	for (var i = [], a = t.length, o, s = t.length, c = 0; c < a; c++) {
		let n = t[c];
		Mn(n, () => {
			if (o) {
				if (o.pending.delete(n), o.done.add(n), o.pending.size === 0) {
					var t = e.outrogroups;
					Xr(e, r(o.done)), t.delete(o), t.size === 0 && (e.outrogroups = null);
				}
			} else --s;
		}, !1);
	}
	if (s === 0) {
		var l = i.length === 0 && n !== null && e.pending.size === 0;
		if (l) {
			var u = n, d = u.parentNode;
			on(d), d.append(u), e.items.clear();
		}
		Xr(e, t, !l);
	} else o = {
		pending: new Set(t),
		done: /* @__PURE__ */ new Set()
	}, (e.outrogroups ??= /* @__PURE__ */ new Set()).add(o);
}
function Xr(e, t, n = !0) {
	var r;
	if (e.pending.size > 0) {
		r = /* @__PURE__ */ new Set();
		for (let t of e.pending.values()) for (let n of t) r.add(e.items.get(n).e);
	}
	for (var i = 0; i < t.length; i++) {
		var a = t[i];
		r?.has(a) ? (a.f |= re, In(a, document.createDocumentFragment())) : kn(t[i], n);
	}
}
var Zr;
function Z(t, n, i, a, o, s = null) {
	var c = t, l = /* @__PURE__ */ new Map();
	if (n & 4) {
		var u = t;
		c = D ? we(/* @__PURE__ */ nn(u)) : u.appendChild(tn());
	}
	D && Te();
	var d = null, f = /* @__PURE__ */ pt(() => {
		var t = i();
		return e(t) ? t : t == null ? [] : r(t);
	}), p, m = /* @__PURE__ */ new Map(), h = !0;
	function g(e) {
		v.effect.f & 16384 || (v.pending.delete(e), v.fallback = d, $r(v, p, c, n, a), d !== null && (p.length === 0 ? d.f & 33554432 ? (d.f ^= re, ti(d, null, c)) : Pn(d) : Mn(d, () => {
			d = null;
		})));
	}
	function _(e) {
		v.pending.delete(e);
	}
	var v = {
		effect: Cn(() => {
			p = G(f);
			var e = p.length;
			let t = !1;
			D && Oe(c) === "[!" != (e === 0) && (c = De(), we(c), Ce(!1), t = !0);
			for (var r = /* @__PURE__ */ new Set(), u = F, v = sn(), y = 0; y < e; y += 1) {
				D && O.nodeType === 8 && O.data === "]" && (c = O, t = !0, Ce(!1));
				var b = p[y], x = a(b, y), S = h ? null : l.get(x);
				S ? (S.v && Wt(S.v, b), S.i && Wt(S.i, y), v && u.unskip_effect(S.e)) : (S = ei(l, h ? c : Zr ??= tn(), b, x, y, o, n, i), h || (S.e.f |= re), l.set(x, S)), r.add(x);
			}
			if (e === 0 && s && !d && (h ? d = Tn(() => s(c)) : (d = Tn(() => s(Zr ??= tn())), d.f |= re)), e > r.size && Pe("", "", ""), D && e > 0 && we(De()), !h) {
				if (m.set(u, r), v) {
					for (let [e, t] of l) r.has(e) || u.skip_effect(t.e);
					u.oncommit(g), u.ondiscard(_);
				} else g(u);
			}
			t && Ce(!0), G(f);
		}),
		flags: n,
		items: l,
		pending: m,
		outrogroups: null,
		fallback: d
	};
	h = !1, D && (c = O);
}
function Qr(e) {
	for (; e !== null && !(e.f & 32);) e = e.next;
	return e;
}
function $r(e, t, n, i, a) {
	var o = !!(i & 8), s = t.length, c = e.items, l = Qr(e.effect.first), u, d = null, f, p = [], m = [], h, g, _, v;
	if (o) for (v = 0; v < s; v += 1) h = t[v], g = a(h, v), _ = c.get(g).e, _.f & 33554432 || (_.nodes?.a?.measure(), (f ??= /* @__PURE__ */ new Set()).add(_));
	for (v = 0; v < s; v += 1) {
		if (h = t[v], g = a(h, v), _ = c.get(g).e, e.outrogroups !== null) for (let t of e.outrogroups) t.pending.delete(_), t.done.delete(_);
		if (_.f & 8192 && (Pn(_), o && (_.nodes?.a?.unfix(), (f ??= /* @__PURE__ */ new Set()).delete(_))), _.f & 33554432) {
			if (_.f ^= re, _ === l) ti(_, null, n);
			else {
				var y = d ? d.next : l;
				_ === e.effect.last && (e.effect.last = _.prev), _.prev && (_.prev.next = _.next), _.next && (_.next.prev = _.prev), ni(e, d, _), ni(e, _, y), ti(_, y, n), d = _, p = [], m = [], l = Qr(d.next);
				continue;
			}
		}
		if (_ !== l) {
			if (u !== void 0 && u.has(_)) {
				if (p.length < m.length) {
					var b = m[0], x;
					d = b.prev;
					var S = p[0], ee = p[p.length - 1];
					for (x = 0; x < p.length; x += 1) ti(p[x], b, n);
					for (x = 0; x < m.length; x += 1) u.delete(m[x]);
					ni(e, S.prev, ee.next), ni(e, d, S), ni(e, ee, b), l = b, d = ee, --v, p = [], m = [];
				} else u.delete(_), ti(_, l, n), ni(e, _.prev, _.next), ni(e, _, d === null ? e.effect.first : d.next), ni(e, d, _), d = _;
				continue;
			}
			for (p = [], m = []; l !== null && l !== _;) (u ??= /* @__PURE__ */ new Set()).add(l), m.push(l), l = Qr(l.next);
			if (l === null) continue;
		}
		_.f & 33554432 || p.push(_), d = _, l = Qr(_.next);
	}
	if (e.outrogroups !== null) {
		for (let t of e.outrogroups) t.pending.size === 0 && (Xr(e, r(t.done)), e.outrogroups?.delete(t));
		e.outrogroups.size === 0 && (e.outrogroups = null);
	}
	if (l !== null || u !== void 0) {
		var te = [];
		if (u !== void 0) for (_ of u) _.f & 8192 || te.push(_);
		for (; l !== null;) !(l.f & 8192) && l !== e.fallback && te.push(l), l = Qr(l.next);
		var ne = te.length;
		if (ne > 0) {
			var ie = i & 4 && s === 0 ? n : null;
			if (o) {
				for (v = 0; v < ne; v += 1) te[v].nodes?.a?.measure();
				for (v = 0; v < ne; v += 1) te[v].nodes?.a?.fix();
			}
			Yr(e, te, ie);
		}
	}
	o && M(() => {
		if (f !== void 0) for (_ of f) _.nodes?.a?.apply();
	});
}
function ei(e, t, n, r, i, a, o, s) {
	var c = o & 1 ? o & 16 ? Bt(n) : /* @__PURE__ */ Vt(n, !1, !1) : null, l = o & 2 ? Bt(i) : null;
	return {
		v: c,
		i: l,
		e: Tn(() => (a(t, c ?? n, l ?? i, s), () => {
			e.delete(r);
		}))
	};
}
function ti(e, t, n) {
	if (e.nodes) for (var r = e.nodes.start, i = e.nodes.end, a = t && !(t.f & 33554432) ? t.nodes.start : n; r !== null;) {
		var o = /* @__PURE__ */ rn(r);
		if (a.before(r), r === i) return;
		r = o;
	}
}
function ni(e, t, n) {
	t === null ? e.effect.first = n : t.next = n, n === null ? e.effect.last = t : n.prev = t;
}
function ri(e, t, n = !1, r = !1, i = !1, a = !1) {
	var o = e, s = "";
	if (n) {
		var c = e;
		D && (o = we(/* @__PURE__ */ nn(c)));
	}
	H(() => {
		var e = W;
		if (s === (s = t() ?? "")) {
			D && Te();
			return;
		}
		if (n && !D) {
			e.nodes = null, c.innerHTML = s, s !== "" && Pr(/* @__PURE__ */ nn(c), c.lastChild);
			return;
		}
		if (e.nodes !== null && (An(e.nodes.start, e.nodes.end), e.nodes = null), s !== "") {
			if (D) {
				for (var a = O.data, l = Te(), u = l; l !== null && (l.nodeType !== 8 || l.data !== "");) u = l, l = /* @__PURE__ */ rn(l);
				if (l === null) throw xe(), w;
				Pr(O, u), o = we(l);
				return;
			}
			var d = cn(r ? "svg" : i ? "math" : "template", r ? ve : i ? ye : void 0);
			d.innerHTML = s;
			var f = r || i ? d : d.content;
			if (Pr(/* @__PURE__ */ nn(f), f.lastChild), r || i) for (; /* @__PURE__ */ nn(f);) o.before(/* @__PURE__ */ nn(f));
			else o.before(f);
		}
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/css.js
function ii(e, t) {
	bn(() => {
		e = W?.parent?.nodes?.start ?? e;
		var n = e.getRootNode(), r = n.host ? n : n.head ?? n.ownerDocument.head;
		if (!r.querySelector("#" + t.hash)) {
			let e = cn("style");
			e.id = t.hash, e.textContent = t.code, r.appendChild(e);
		}
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/actions.js
function ai(e, t, n) {
	bn(() => {
		var r = dr(() => t(e, n?.()) || {});
		if (n && r?.update) {
			var i = !1, a = {};
			Sn(() => {
				var e = n();
				fr(e), i && Ae(a, e) && (a = e, r.update(e));
			}), i = !0;
		}
		if (r?.destroy) return () => r.destroy();
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/attachments.js
function oi(e, t) {
	var n = void 0, r;
	wn(() => {
		n !== (n = t()) && (r &&= (kn(r), null), n && (r = Tn(() => {
			bn(() => n(e));
		})));
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/clsx/dist/clsx.mjs
function si(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = si(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function ci() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = si(e)) && (r && (r += " "), r += t);
	return r;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/shared/attributes.js
function li(e) {
	return typeof e == "object" ? ci(e) : e ?? "";
}
var ui = [..." 	\n\r\f\xA0\v﻿"];
function di(e, t, n) {
	var r = e == null ? "" : "" + e;
	if (t && (r = r ? r + " " + t : t), n) {
		for (var i of Object.keys(n)) if (n[i]) r = r ? r + " " + i : i;
		else if (r.length) for (var a = i.length, o = 0; (o = r.indexOf(i, o)) >= 0;) {
			var s = o + a;
			(o === 0 || ui.includes(r[o - 1])) && (s === r.length || ui.includes(r[s])) ? r = (o === 0 ? "" : r.substring(0, o)) + r.substring(s + 1) : o = s;
		}
	}
	return r === "" ? null : r;
}
function fi(e, t = !1) {
	var n = t ? " !important;" : ";", r = "";
	for (var i of Object.keys(e)) {
		var a = e[i];
		a != null && a !== "" && (r += " " + i + ": " + a + n);
	}
	return r;
}
function pi(e) {
	return e[0] !== "-" || e[1] !== "-" ? e.toLowerCase() : e;
}
function mi(e, t) {
	if (t) {
		var n = "", r, i;
		if (Array.isArray(t) ? (r = t[0], i = t[1]) : r = t, e) {
			e = String(e).replaceAll(/\/\*.*?\*\//g, "").trim();
			var a = !1, o = 0, s = !1, c = [];
			r && c.push(...Object.keys(r).map(pi)), i && c.push(...Object.keys(i).map(pi));
			var l = 0, u = -1;
			let t = e.length;
			for (var d = 0; d < t; d++) {
				var f = e[d];
				if (s ? f === "/" && e[d - 1] === "*" && (s = !1) : a ? a === f && (a = !1) : f === "/" && e[d + 1] === "*" ? s = !0 : f === "\"" || f === "'" ? a = f : f === "(" ? o++ : f === ")" && o--, !s && a === !1 && o === 0) {
					if (f === ":" && u === -1) u = d;
					else if (f === ";" || d === t - 1) {
						if (u !== -1) {
							var p = pi(e.substring(l, u).trim());
							if (!c.includes(p)) {
								f !== ";" && d++;
								var m = e.substring(l, d).trim();
								n += " " + m + ";";
							}
						}
						l = d + 1, u = -1;
					}
				}
			}
		}
		return r && (n += fi(r)), i && (n += fi(i, !0)), n = n.trim(), n === "" ? null : n;
	}
	return e == null ? null : String(e);
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/class.js
function Q(e, t, n, r, i, a) {
	var o = e[fe];
	if (D || o !== n || o === void 0) {
		var s = di(n, r, a);
		(!D || s !== e.getAttribute("class")) && (s == null ? e.removeAttribute("class") : t ? e.className = s : e.setAttribute("class", s)), e[fe] = n;
	} else if (a && i !== a) for (var c in a) {
		var l = !!a[c];
		(i == null || l !== !!i[c]) && e.classList.toggle(c, l);
	}
	return a;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/style.js
function hi(e, t = {}, n, r) {
	for (var i in n) {
		var a = n[i];
		t[i] !== a && (n[i] == null ? e.style.removeProperty(i) : e.style.setProperty(i, a, r));
	}
}
function gi(e, t, n, r) {
	var i = e[pe];
	if (D || i !== t) {
		var a = mi(t, r);
		(!D || a !== e.getAttribute("style")) && (a == null ? e.removeAttribute("style") : e.style.cssText = a), e[pe] = t;
	} else r && (Array.isArray(r) ? (hi(e, n?.[0], r[0]), hi(e, n?.[1], r[1], "important")) : hi(e, n, r));
	return r;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/bindings/select.js
function _i(e, t) {
	t ? e.hasAttribute("selected") || e.setAttribute("selected", "") : e.removeAttribute("selected");
}
function vi(e, t) {
	var n = !("__defaultValue" in e);
	(n || e.__defaultValue !== t) && (e.__defaultValue = t, yi(e, !n || "__value" in e));
}
function yi(t, n) {
	var r = t.__defaultValue, i = t.multiple, a = i ? r ?? [] : null;
	if (!i || e(a)) {
		var o = t.selectedIndex, s = n && i ? new Set(t.selectedOptions) : null;
		for (var c of t.options) {
			var l = Si(c);
			_i(c, i ? a.includes(l) : Yt(l, r));
		}
		if (n) {
			if (s !== null) for (c of t.options) {
				var u = s.has(c);
				c.selected !== u && (c.selected = u);
			}
			else t.selectedIndex !== o && (t.selectedIndex = o);
		}
	}
}
function bi(t, n, r = !1) {
	if (t.multiple) {
		if (n == null) return;
		if (!e(n)) return E();
		for (var i of t.options) i.selected = n.includes(Si(i));
		return;
	}
	for (i of t.options) if (Yt(Si(i), n)) {
		i.selected = !0;
		return;
	}
	(!r || n !== void 0) && (t.selectedIndex = -1);
}
function xi(e) {
	var t = new MutationObserver((t) => {
		t.every(Ci) || ("__defaultValue" in e && yi(e, !1), "__value" in e && bi(e, e.__value));
	});
	t.observe(e, {
		childList: !0,
		subtree: !0,
		attributes: !0,
		attributeFilter: ["value"]
	}), gn(() => {
		t.disconnect();
	});
}
function Si(e) {
	return "__value" in e ? e.__value : e.value;
}
function Ci(e) {
	if (e.target.closest("selectedcontent") !== null) return !0;
	if (e.type === "childList") {
		var t = [...e.addedNodes, ...e.removedNodes];
		return t.length > 0 && t.every((e) => e.nodeName === "SELECTEDCONTENT");
	}
	return !1;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/attributes.js
var wi = Symbol("class"), Ti = Symbol("style"), Ei = Symbol("is custom element"), Di = Symbol("is html"), Oi = ge ? "link" : "LINK", ki = ge ? "input" : "INPUT", Ai = ge ? "option" : "OPTION", ji = ge ? "select" : "SELECT";
function Mi(e) {
	if (D) {
		var t = !1, n = () => {
			if (!t) {
				if (t = !0, e.hasAttribute("value")) {
					var n = e.value;
					$(e, "value", null), e.value = n;
				}
				if (e.hasAttribute("checked")) {
					var r = e.checked;
					$(e, "checked", null), e.checked = r;
				}
			}
		};
		e[C] = n, M(n), rt();
	}
}
function $(e, t, n, r) {
	var i = Fi(e);
	D && (i[t] = e.getAttribute(t), t === "src" || t === "srcset" || t === "href" && e.nodeName === Oi) || i[t] !== (i[t] = n) && (t === "loading" && (e[ue] = n), n == null ? e.removeAttribute(t) : typeof n != "string" && Li(e).has(t) ? e[t] = n : e.setAttribute(t, n));
}
function Ni(e, t, n, r, i = !1, a = !1) {
	D && i && e.nodeName === ki && ("defaultValue" in n || "defaultChecked" in n || Mi(e));
	var o = Fi(e), s = o[Ei], c = !o[Di];
	let l = D && s;
	l && Ce(!1);
	var u = t || {}, d = e.nodeName === Ai, f = e.nodeName === ji;
	for (var p in t) !(p in n) && p[0] + p[1] !== "$$" && (n[p] = null);
	n.class ? n.class = li(n.class) : (r || n[wi]) && (n.class = null), n[Ti] && (n.style ??= null);
	var m = Li(e);
	if (e.nodeName === ki && "type" in n && ("value" in n || "__value" in n)) {
		var h = n.type;
		(h !== u.type || h === void 0 && e.hasAttribute("type")) && (u.type = h, $(e, "type", h, a));
	}
	for (let i in n) {
		let l = n[i];
		if (d && i === "value" && l == null) {
			e.value = e.__value = "", u[i] = l;
			continue;
		}
		if (i === "class") {
			Q(e, e.namespaceURI === "http://www.w3.org/1999/xhtml", l, r, t?.[wi], n[wi]), u[i] = l, u[wi] = n[wi];
			continue;
		}
		if (i === "style") {
			gi(e, l, t?.[Ti], n[Ti]), u[i] = l, u[Ti] = n[Ti];
			continue;
		}
		var g = u[i];
		if (l !== g || l === void 0 && e.hasAttribute(i)) {
			u[i] = l;
			var _ = i[0] + i[1];
			if (_ !== "$$") {
				if (_ === "on") {
					let t = {}, n = "$$" + i, r = i.slice(2);
					var v = gr(r);
					if (mr(r) && (r = r.slice(0, -7), t.capture = !0), !v && g) {
						if (l != null) continue;
						e.removeEventListener(r, u[n], t), u[n] = null;
					}
					if (v) K(r, e, l), Dr([r]);
					else if (l != null) {
						function a(e) {
							u[i].call(this, e);
						}
						u[n] = Tr(r, e, a, t);
					}
				} else if (i === "style") $(e, i, l);
				else if (i === "autofocus") et(e, !!l);
				else if (!s && (i === "__value" || i === "value" && l != null)) e.value = e.__value = l;
				else if (i === "selected" && d) _i(e, l);
				else {
					var y = i;
					c || (y = yr(y));
					var b = y === "defaultValue" || y === "defaultChecked";
					if (f && y === "defaultValue") continue;
					if (l == null && !s && !b) {
						if (o[i] = null, y === "value" || y === "checked") {
							let n = e, r = t === void 0;
							if (y === "value") {
								let e = n.defaultValue;
								n.removeAttribute(y), n.defaultValue = e, n.value = n.__value = r ? e : null;
							} else {
								let e = n.defaultChecked;
								n.removeAttribute(y), n.defaultChecked = e, n.checked = r ? e : !1;
							}
						} else e.removeAttribute(i);
					} else b || (s || typeof l != "string") && m.has(y) ? (e[y] = l, y in o && (o[y] = T)) : typeof l != "function" && $(e, y, l, a);
				}
			}
		}
	}
	return l && Ce(!0), u;
}
function Pi(e, t, n = [], r = [], i = [], a, o = !1, s = !1) {
	ot(i, n, r, (n) => {
		var r = void 0, i = {}, c = e.nodeName === ji, l = !1;
		if (wn(() => {
			var u = t(...n.map(G)), d = Ni(e, r, u, a, o, s);
			if (l && c) {
				var f = e;
				"defaultValue" in u && vi(f, u.defaultValue), "value" in u && bi(f, u.value);
			}
			for (let e of Object.getOwnPropertySymbols(i)) u[e] || kn(i[e]);
			for (let t of Object.getOwnPropertySymbols(u)) {
				var p = u[t];
				t.description === "@attach" && (!r || p !== r[t]) && (i[t] && kn(i[t]), i[t] = Tn(() => oi(e, () => p))), d[t] = p;
			}
			r = d;
		}), c) {
			var u = e;
			bn(() => {
				var e = r;
				"defaultValue" in e && vi(u, e.defaultValue), bi(u, e.value, !0), xi(u);
			});
		}
		l = !0;
	});
}
function Fi(e) {
	return e[de] ??= {
		[Ei]: e.nodeName.includes("-"),
		[Di]: e.namespaceURI === _e
	};
}
var Ii = /* @__PURE__ */ new Map();
function Li(e) {
	var t = e.getAttribute("is") || e.nodeName, n = Ii.get(t);
	if (n) return n;
	Ii.set(t, n = /* @__PURE__ */ new Set());
	for (var r, i = e, a = Element.prototype; a !== i;) {
		for (var s in r = o(i), r) r[s].set && s !== "innerHTML" && s !== "textContent" && s !== "innerText" && n.add(s);
		i = l(i);
	}
	return n;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/bindings/input.js
function Ri(e, t, n = t) {
	var r = /* @__PURE__ */ new WeakSet();
	at(e, "input", async (i) => {
		var a = i ? e.defaultValue : e.value;
		if (a = zi(e) ? Bi(a) : a, n(a), F !== null && r.add(F), await cr(), a !== (a = t())) {
			var o = e.selectionStart, s = e.selectionEnd, c = e.value.length;
			if (e.value = a ?? "", s !== null) {
				var l = e.value.length;
				o === s && s === c && l > c ? (e.selectionStart = l, e.selectionEnd = l) : (e.selectionStart = o, e.selectionEnd = Math.min(s, l));
			}
		}
	}), (D && e.defaultValue !== e.value || dr(t) == null && e.value) && (n(zi(e) ? Bi(e.value) : e.value), F !== null && r.add(F)), Sn(() => {
		var n = t();
		if (e === document.activeElement) {
			var i = F;
			if (r.has(i)) return;
		}
		zi(e) && n === Bi(e.value) || (e.type !== "date" || n || e.value) && n !== e.value && (e.value = n ?? "");
	});
}
function zi(e) {
	var t = e.type;
	return t === "number" || t === "range";
}
function Bi(e) {
	return e === "" ? null : +e;
}
var Vi = /* @__PURE__ */ new class e {
	#e = /* @__PURE__ */ new WeakMap();
	#t;
	#n;
	static entries = /* @__PURE__ */ new WeakMap();
	constructor(e) {
		this.#n = e;
	}
	observe(e, t) {
		var n = this.#e.get(e) || /* @__PURE__ */ new Set();
		return n.add(t), this.#e.set(e, n), this.#r().observe(e, this.#n), () => {
			var n = this.#e.get(e);
			n.delete(t), n.size === 0 && (this.#e.delete(e), this.#t.unobserve(e));
		};
	}
	#r() {
		return this.#t ??= new ResizeObserver((t) => {
			for (var n of t) {
				e.entries.set(n.target, n);
				for (var r of this.#e.get(n.target) || []) r(n);
			}
		});
	}
}({ box: "border-box" });
function Hi(e, t, n) {
	var r = Vi.observe(e, () => n(e[t]));
	bn(() => (dr(() => n(e[t])), r));
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/dom/elements/bindings/this.js
function Ui(e, t) {
	return e === t || e?.[se] === t;
}
function Wi(e = Ke(), t, n, r) {
	var i = j.r, a = W;
	return bn(() => {
		var o, s;
		return Sn(() => {
			o = s, s = r?.() || [], dr(() => {
				Ui(n(...s), e) || (t(e, ...s), o && Ui(n(...o), e) && t(null, ...o));
			});
		}), () => {
			let r = a;
			for (; r !== i && r.parent !== null && r.parent.f & 33554432;) r = r.parent;
			let o = () => {
				s && Ui(n(...s), e) && t(null, ...s);
			}, c = r.teardown;
			r.teardown = () => {
				o(), c?.();
			};
		};
	}), e;
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/store.js
var Gi = !1;
function Ki(e) {
	var t = Gi;
	try {
		return Gi = !1, [e(), Gi];
	} finally {
		Gi = t;
	}
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/client/reactivity/props.js
function qi(e, t, n, r) {
	var i = !0, o = !!(n & 8), s = !!(n & 16), c = r, l = !0, u = void 0, d = () => s && i ? (u ??= /* @__PURE__ */ ut(r), G(u)) : (l && (l = !1, c = s ? dr(r) : r), c);
	let f;
	if (o) {
		var p = se in e || le in e;
		f = a(e, t)?.set ?? (p && t in e ? (n) => e[t] = n : void 0);
	}
	var m, h = !1;
	o ? [m, h] = Ki(() => e[t]) : m = e[t], m === void 0 && r !== void 0 && (m = d(), f && (i && Re(t), f(m)));
	var g = i ? () => {
		var n = e[t];
		return n === void 0 ? d() : (l = !0, n);
	} : () => {
		var n = e[t];
		return n !== void 0 && (c = void 0), n === void 0 ? c : n;
	};
	if (i && !(n & 4)) return g;
	if (f) {
		var _ = e.$$legacy;
		return (function(e, t) {
			return arguments.length > 0 ? ((!i || !t || _ || h) && f(t ? g() : e), e) : g();
		});
	}
	var v = !1, y = (n & 1 ? ut : pt)(() => (v = !1, g()));
	o && G(y);
	var b = W;
	return (function(e, t) {
		if (arguments.length > 0) {
			let n = t ? G(y) : i && o ? R(e) : e;
			return L(y, n), v = !0, c !== void 0 && (c = n), e;
		}
		return zn && v || b.f & 16384 ? y.v : G(y);
	});
}
function Ji(e) {
	j === null && Me("onMount"), _n(() => {
		let t = dr(e);
		if (typeof t == "function") return t;
	});
}
//#endregion
//#region ../../../../../../../../Documents/GitHub/kandinsky/ui/node_modules/svelte/src/internal/disclose-version.js
typeof window < "u" && ((window.__svelte ??= {}).v ??= /* @__PURE__ */ new Set()).add("5");
//#endregion
//#region ui/src/lib/prefs.ts
function Yi(e, t) {
	try {
		let n = localStorage.getItem(e);
		return n === null ? t : JSON.parse(n);
	} catch {
		return t;
	}
}
function Xi(e, t) {
	try {
		localStorage.setItem(e, JSON.stringify(t));
	} catch {}
}
//#endregion
//#region ui/src/lib/text.ts
var Zi = (e) => String(e instanceof Error ? e.message : e), Qi = new Intl.Collator(void 0, {
	numeric: !0,
	sensitivity: "base"
});
function $i(e, t) {
	let n = (e) => e.sort[t.id] ?? "";
	return [...e].sort((e, r) => {
		let i = n(e), a = n(r), o = typeof i == "number" && typeof a == "number" ? i - a : Qi.compare(String(i), String(a));
		return (t.desc ? -o : o) || e.id.localeCompare(r.id);
	});
}
function ea(e, t) {
	return e.filter((e) => typeof e.lastUsed == "number" && e.lastUsed > 0 && (e.progress ?? 0) < 1).sort((e, t) => t.lastUsed - e.lastUsed || e.id.localeCompare(t.id)).slice(0, t);
}
var ta = /* @__PURE__ */ new Map(), na = /* @__PURE__ */ new Map();
function ra(e, t) {
	let n = e.text.toLowerCase();
	return t.toLowerCase().split(/\s+/).filter(Boolean).every((e) => n.includes(e));
}
var ia = " › ", aa = (e, t) => (e ?? []).some((e) => e === t || e.startsWith(t + " › "));
function oa(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let [t, r] of e) {
		let e = t.split(ia);
		e.forEach((t, i) => {
			let a = e.slice(0, i + 1).join(ia), o = n.get(a) ?? {
				path: a,
				name: t,
				depth: i,
				count: 0,
				kids: !1
			};
			o.count += r, i < e.length - 1 && (o.kids = !0), n.set(a, o);
		});
	}
	return [...n.values()].sort((e, t) => e.path.localeCompare(t.path)).filter((e) => {
		let n = e.path.split(ia);
		return n.slice(0, -1).every((e, r) => t.has(n.slice(0, r + 1).join(ia)));
	});
}
function sa(e, t, n = []) {
	let r = /* @__PURE__ */ new Map();
	for (let n of e) for (let e of t(n) ?? []) r.set(e, (r.get(e) ?? 0) + 1);
	let i = [...r].filter(([e]) => !n.includes(e)).sort((e, t) => e[0].localeCompare(t[0]));
	return [...n.map((e) => [e, r.get(e) ?? 0]), ...i];
}
function ca(e, t, n, r) {
	let i = /* @__PURE__ */ new Map(), a = (e) => i.get(e.id), o = (e) => (typeof e.tabs == "function" ? e.tabs() : e.tabs) ?? [], s = (e, t) => {
		if (e.from) return [];
		let n = o(e);
		return n.length ? n.map((e) => ({
			...e,
			id: `${t}␟${e.id}`
		})) : [{
			id: `${t}␟`,
			title: e.title
		}];
	}, c = (e) => {
		let t = /* @__PURE__ */ new Map();
		for (let n of e) {
			let e = a(n);
			e && t.set(e.part, [...t.get(e.part) ?? [], e.item]);
		}
		return t;
	}, l = (e, t) => {
		let n = /* @__PURE__ */ new Set();
		return e.flat().filter((e) => !n.has(t(e)) && !!n.add(t(e)));
	}, u = (e) => r.find((t) => t[e]), d = u("drop")?.drop;
	return {
		id: e,
		title: t,
		icon: n,
		noun: r[0].noun,
		async load() {
			i.clear();
			let e = await Promise.all(r.map((e) => e.load().catch(() => []))), t = /* @__PURE__ */ new Set();
			return e.flatMap((e, n) => e.flatMap((e) => {
				if (e.note && !(e.from ?? r[n].from)) {
					if (t.has(e.note)) return [];
					t.add(e.note);
				}
				let a = {
					...e,
					id: `${n}␟${e.id}`,
					tab: r[n].from ? void 0 : `${n}␟${o(r[n]).length ? e.tab ?? "" : ""}`,
					from: e.from ?? r[n].from
				};
				return i.set(a.id, {
					part: r[n],
					item: e
				}), [a];
			}));
		},
		tabs: () => r.flatMap(s),
		groupsTitle: r.map((e) => e.groupsTitle).find(Boolean),
		groupOrder: l(r.map((e) => e.groupOrder ?? []), (e) => e),
		regroup: r.some((e) => e.regroup) ? async (e, t) => {
			for (let [n, r] of c(e)) await n.regroup?.(r, t);
		} : void 0,
		layouts: l(r.map((e) => e.layouts), (e) => e),
		from: r.every((e) => e.from) ? r[0].from : void 0,
		homes: l(r.map((e) => e.homes ?? []), (e) => e.from),
		sorts: l(r.map((e) => e.sorts), (e) => e.id),
		search: r[0].search,
		empty: r.map((e) => e.empty).join(" "),
		detail: (e) => {
			let t = a(e);
			return t ? t.part.detail(t.item) : {
				title: e.title,
				actions: []
			};
		},
		add: u("add")?.add,
		drop: d ? {
			hint: d.hint,
			accept: d.accept,
			run: (e, t) => d.run(e, t)
		} : void 0,
		tools: r.some((e) => e.tools) ? async () => (await Promise.all(r.map((e) => e.tools?.() ?? []))).flat() : void 0,
		watch: (e) => {
			let t = r.map((t) => t.watch?.(e));
			return () => t.forEach((e) => e?.());
		},
		keys: Object.assign({}, ...r.map((e) => Object.fromEntries(Object.entries(e.keys ?? {}).map(([t, n]) => [t, (t) => {
			let r = a(t);
			r?.part === e && n(r.item);
		}])))),
		open: (e) => {
			let t = a(e);
			t?.part.open?.(t.item);
		},
		many: (e) => {
			let t = c(e);
			if (t.size !== 1) return [];
			let [[n, r]] = [...t];
			return n.many?.(r) ?? [];
		}
	};
}
var la = (e) => e.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), ua = (e) => e.subject ?? la(e.title), da = /* @__PURE__ */ new Map();
function fa(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) t.set(ua(n), [...t.get(ua(n)) ?? [], n]);
	return [...t].map(([e, t]) => {
		if (t.length === 1) return t[0];
		let n = t.map((e) => e.id).join("\n"), r = da.get(n);
		if (!r || t.some((e, t) => r.members[t] !== e.id)) {
			let i = t.find((t) => la(t.title) === e)?.title ?? t[0].title, a = t[0].icon;
			r = {
				id: t[0].id,
				title: i,
				icon: a,
				by: t[0].by,
				subject: e,
				members: t.map((e) => e.id),
				from: t.every((e) => e.from) ? t[0].from : void 0,
				source: async () => ca(t[0].id, i, a, await Promise.all(t.map((e) => e.source())))
			}, da.set(n, r);
		}
		return r;
	});
}
//#endregion
//#region ui/src/lib/keys.ts
var pa = !1, ma = /^(Meta|OS|Super|Hyper)(Left|Right)?$/;
if (typeof window < "u") {
	let e = (e) => (t) => {
		(ma.test(t.key) || ma.test(t.code)) && (pa = e);
	};
	window.addEventListener("keydown", e(!0), !0), window.addEventListener("keyup", e(!1), !0), window.addEventListener("blur", () => {
		pa = !1;
	});
}
function ha(e) {
	return e.metaKey || pa || e.getModifierState?.("Super") || e.getModifierState?.("OS") || !1;
}
//#endregion
//#region ui/src/lib/marquee.ts
var ga = 5;
function _a(e, t) {
	let n = t, r = null, i = null, a = {
		x: 0,
		y: 0
	}, o = (t, n) => {
		let r = e.getBoundingClientRect();
		return {
			x: t - r.left + e.scrollLeft,
			y: n - r.top + e.scrollTop
		};
	};
	function s(t, a) {
		if (!r || !i) return;
		let s = o(t, a), c = Math.min(r.x, s.x), l = Math.min(r.y, s.y), u = Math.max(r.x, s.x), d = Math.max(r.y, s.y);
		Object.assign(i.style, {
			left: `${c}px`,
			top: `${l}px`,
			width: `${u - c}px`,
			height: `${d - l}px`
		});
		let f = e.getBoundingClientRect(), p = [];
		for (let t of e.querySelectorAll("[data-pick]")) {
			let n = t.getBoundingClientRect(), r = n.left - f.left + e.scrollLeft, i = n.top - f.top + e.scrollTop;
			r < u && r + n.width > c && i < d && i + n.height > l && p.push(t.dataset.pick);
		}
		n.pick(p, r.add);
	}
	let c = (e) => e.button !== 0 || !!e.target.closest("input, textarea, select, a, [contenteditable], [draggable=true]");
	function l(t) {
		c(t) || t.offsetX > e.clientWidth && t.target === e || (t.preventDefault(), e.closest("[tabindex]")?.focus({ preventScroll: !0 }));
	}
	function u(t) {
		c(t) || t.pointerType === "touch" || t.offsetX > e.clientWidth && t.target === e || (r = {
			...o(t.clientX, t.clientY),
			add: t.ctrlKey || t.metaKey || t.shiftKey,
			id: t.pointerId
		}, a = {
			x: t.clientX,
			y: t.clientY
		});
	}
	function d(t) {
		if (!r || t.pointerId !== r.id) return;
		if (a = {
			x: t.clientX,
			y: t.clientY
		}, !i) {
			let n = o(t.clientX, t.clientY);
			if (Math.hypot(n.x - r.x, n.y - r.y) < ga) return;
			i = document.createElement("div"), i.className = "marquee", e.append(i), e.setPointerCapture(t.pointerId), window.getSelection()?.removeAllRanges();
		}
		let n = e.getBoundingClientRect();
		t.clientY < n.top + 24 ? e.scrollTop -= 16 : t.clientY > n.bottom - 24 && (e.scrollTop += 16), s(t.clientX, t.clientY);
	}
	function f(t) {
		if (!r || t.pointerId !== r.id) return;
		let n = !!i;
		if (i?.remove(), i = null, r = null, !n) return;
		let a = (e) => {
			e.stopPropagation(), e.preventDefault();
		};
		e.addEventListener("click", a, {
			capture: !0,
			once: !0
		}), setTimeout(() => e.removeEventListener("click", a, { capture: !0 }), 0);
	}
	let p = () => {
		i && s(a.x, a.y);
	};
	return e.addEventListener("mousedown", l), e.addEventListener("pointerdown", u), e.addEventListener("pointermove", d), e.addEventListener("pointerup", f), e.addEventListener("pointercancel", f), e.addEventListener("scroll", p), {
		update(e) {
			n = e;
		},
		destroy() {
			i?.remove(), e.removeEventListener("mousedown", l), e.removeEventListener("pointerdown", u), e.removeEventListener("pointermove", d), e.removeEventListener("pointerup", f), e.removeEventListener("pointercancel", f), e.removeEventListener("scroll", p);
		}
	};
}
//#endregion
//#region ui/src/lib/back.ts
var va = globalThis, ya = va.kandinskyBackStack ??= va.atlasBackStack ?? [];
va.atlasBackStack = ya;
function ba(e, t) {
	let n = {
		close: e,
		shown: t
	};
	return ya.push(n), () => {
		let e = ya.lastIndexOf(n);
		e >= 0 && ya.splice(e, 1);
	};
}
//#endregion
//#region ui/src/components/Select.svelte
var xa = /* @__PURE__ */ q("<span class=\"n svelte-ifm9j5\"> </span>"), Sa = /* @__PURE__ */ q("<li role=\"option\"><span class=\"l svelte-ifm9j5\"> </span><!></li>"), Ca = /* @__PURE__ */ q("<ul class=\"menu svelte-ifm9j5\" role=\"listbox\" tabindex=\"-1\"></ul>"), wa = /* @__PURE__ */ q("<div class=\"select svelte-ifm9j5\"><button type=\"button\" class=\"trigger svelte-ifm9j5\" aria-haspopup=\"listbox\"><span class=\"cur svelte-ifm9j5\"> </span> <svg viewBox=\"0 0 16 16\" width=\"12\" height=\"12\" aria-hidden=\"true\" class=\"svelte-ifm9j5\"><path d=\"M4 6l4 4 4-4\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path></svg></button> <!></div>"), Ta = {
	hash: "svelte-ifm9j5",
	code: ".select.svelte-ifm9j5 {position:relative;display:inline-block;min-width:180px;max-width:100%;}.trigger.svelte-ifm9j5 {display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;font:inherit;font-size:calc(13px * var(--ui-scale, 1));color:var(--text);background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:5px 9px;text-align:left;}.trigger.svelte-ifm9j5:hover {border-color:var(--text-faint);}.trigger.svelte-ifm9j5:focus-visible, .trigger[aria-expanded=\"true\"].svelte-ifm9j5 {outline:none;border-color:var(--accent);}.cur.svelte-ifm9j5 {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}svg.svelte-ifm9j5 {flex:none;color:var(--text-muted);}.menu.svelte-ifm9j5 {position:absolute;z-index:50;top:calc(100% + 4px);left:0;min-width:100%;max-width:460px;max-height:300px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);box-shadow:var(--shadow-pop);}li.svelte-ifm9j5 {display:flex;flex-direction:column;gap:1px;padding:5px 9px;border-radius:4px;cursor:pointer;color:var(--text);font-size:calc(13px * var(--ui-scale, 1));}li.on.svelte-ifm9j5 {background:var(--bg-hover);}li.cur.svelte-ifm9j5 .l:where(.svelte-ifm9j5) {color:var(--accent);font-weight:600;}.n.svelte-ifm9j5 {color:var(--text-muted);font-size:.86em;}"
};
function Ea(e, t) {
	We(t, !0), ii(e, Ta);
	let n = /* @__PURE__ */ I(!1), r = /* @__PURE__ */ I(0), i, a = /* @__PURE__ */ I(void 0), o = /* @__PURE__ */ P(() => t.options.find((e) => e.value === t.value));
	_n(() => {
		if (G(n)) return ba(() => L(n, !1));
	});
	function s() {
		L(r, Math.max(0, t.options.findIndex((e) => e.value === t.value)), !0), L(n, !0), requestAnimationFrame(() => G(a)?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
	}
	function c(e) {
		L(n, !1), t.options[e] && t.options[e].value !== t.value && t.onchange(t.options[e].value), i.querySelector("button")?.focus();
	}
	function l(e) {
		if (!G(n)) {
			[
				"Enter",
				" ",
				"ArrowDown",
				"ArrowUp"
			].includes(e.key) && (e.preventDefault(), s());
			return;
		}
		if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), L(n, !1);
		else if (e.key === "ArrowDown") e.preventDefault(), L(r, Math.min(t.options.length - 1, G(r) + 1), !0);
		else if (e.key === "ArrowUp") e.preventDefault(), L(r, Math.max(0, G(r) - 1), !0);
		else if (e.key === "Enter" || e.key === " ") e.preventDefault(), c(G(r));
		else if (e.key.length === 1) {
			let n = t.options.findIndex((t) => t.label.toLowerCase().startsWith(e.key.toLowerCase()));
			n >= 0 && L(r, n, !0);
		} else return;
		requestAnimationFrame(() => G(a)?.children[G(r)]?.scrollIntoView({ block: "nearest" }));
	}
	function u(e) {
		i.contains(e.relatedTarget) || L(n, !1);
	}
	var d = wa(), f = z(d), p = B(z(f), !0);
	Ee(2), k(f);
	var m = V(f, 2), h = (e) => {
		var n = Ca();
		Z(n, 23, () => t.options, (e) => e.value, (e, n, i) => {
			var a = Sa();
			let o;
			var s = z(a), l = B(s, !0), u = V(s), d = (e) => {
				var t = xa(), r = B(t, !0);
				H(() => Y(r, G(n).note)), J(e, t);
			};
			X(u, (e) => {
				G(n).note && e(d);
			}), k(a), H(() => {
				$(a, "aria-selected", G(n).value === t.value), o = Q(a, 1, "svelte-ifm9j5", null, o, {
					on: G(i) === G(r),
					cur: G(n).value === t.value
				}), Y(l, G(n).label);
			}), K("mousedown", a, (e) => {
				e.preventDefault(), c(G(i));
			}), K("mousemove", a, () => L(r, G(i), !0)), J(e, a);
		}), k(n), Wi(n, (e) => L(a, e), () => G(a)), J(e, n);
	};
	X(m, (e) => {
		G(n) && e(h);
	}), k(d), Wi(d, (e) => i = e, () => i), H(() => {
		$(f, "id", t.id), $(f, "aria-expanded", G(n)), $(f, "aria-label", t.label), $(f, "title", G(o)?.note), Y(p, G(o)?.label ?? t.value);
	}), K("focusout", d, u), K("click", f, () => G(n) ? L(n, !1) : s()), K("keydown", f, l), J(e, d), Ge();
}
Dr([
	"focusout",
	"click",
	"keydown",
	"mousedown",
	"mousemove"
]);
//#endregion
//#region ui/src/lib/icons.ts
var Da = {
	mic: "<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7\"/>",
	camera: "<path d=\"M4 8.5A2 2 0 0 1 6 6.5h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/>",
	indent: "<path d=\"M11 6h9M11 12h9M11 18h9\"/><path d=\"m4 9 3 3-3 3\"/>",
	outdent: "<path d=\"M11 6h9M11 12h9M11 18h9\"/><path d=\"m7 9-3 3 3 3\"/>",
	brackets: "<path d=\"M7 4H4.5v16H7M10 4H8.5v16H10M17 4h2.5v16H17M14 4h1.5v16H14\"/>",
	"keyboard-down": "<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"11\" rx=\"2\"/><path d=\"M7 7.5h.01M11 7.5h.01M15 7.5h.01M8 11h8\"/><path d=\"m9 18 3 3 3-3\"/>",
	key: "<circle cx=\"7.5\" cy=\"15.5\" r=\"4\"/><path d=\"m10.4 12.6 9.1-9.1M16 7l2.5 2.5M18.5 4.5 21 7\"/>",
	user: "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4.5 20.5a7.5 7.5 0 0 1 15 0\"/>",
	plugin: "<path d=\"M9 3.5v4M15 3.5v4\"/><path d=\"M6 7.5h12v4a6 6 0 0 1-12 0z\"/><path d=\"M12 17.5v3\"/>",
	today: "<rect x=\"3\" y=\"4.5\" width=\"18\" height=\"16.5\" rx=\"2.5\"/><path d=\"M8 2.5v4M16 2.5v4M3 10h18\"/><path d=\"M8.5 15l2.3 2.3L15.5 12.8\"/>",
	home: "<path d=\"M3.5 10.5 12 3.5l8.5 7\"/><path d=\"M5.5 9v10a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9\"/><path d=\"M10 21v-5.5h4V21\"/>",
	files: "<path d=\"M4 6.5A2.5 2.5 0 0 1 6.5 4h3.3l2 2.2h5.7A2.5 2.5 0 0 1 20 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z\"/>",
	search: "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m20 20-4.3-4.3\"/>",
	lecture: "<path d=\"M2.5 6.5 12 3l9.5 3.5L12 10z\"/><path d=\"M6 8.3v5.2c0 1.4 2.7 3 6 3s6-1.6 6-3V8.3\"/><path d=\"M21.5 6.5v6\"/>",
	command: "<path d=\"M9 6.5V17.5M15 6.5V17.5M6.5 9H17.5M6.5 15H17.5\"/><path d=\"M9 6.5a2.5 2.5 0 1 0-2.5 2.5M15 6.5A2.5 2.5 0 1 1 17.5 9M9 17.5A2.5 2.5 0 1 1 6.5 15M15 17.5a2.5 2.5 0 1 0 2.5-2.5\"/>",
	file: "<path d=\"M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z\"/><path d=\"M14 3v5h5\"/>",
	"file-text": "<path d=\"M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z\"/><path d=\"M14 3v5h5M9 13h6M9 17h4\"/>",
	"file-code": "<path d=\"M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z\"/><path d=\"M14 3v5h5M10 12.5l-2 2 2 2M14 12.5l2 2-2 2\"/>",
	pdf: "<path d=\"M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z\"/><path d=\"M14 3v5h5\"/><path d=\"M8.5 17.5c2-1.2 4.5-4.6 4.2-6.6-.3-1.6-2.2-.6-1.4 1.4.9 2.4 3.3 4.4 4.9 4.6\"/>",
	image: "<rect x=\"3\" y=\"3.5\" width=\"18\" height=\"17\" rx=\"2.5\"/><circle cx=\"9\" cy=\"9.5\" r=\"1.8\"/><path d=\"m21 15.5-4.5-4.5L6 20.5\"/>",
	terminal: "<rect x=\"2.5\" y=\"4\" width=\"19\" height=\"16\" rx=\"2.5\"/><path d=\"m7 9.5 3 2.5-3 2.5M12.5 15h4.5\"/>",
	claude: "<path d=\"M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18\"/>",
	globe: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z\"/>",
	mail: "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2.5\"/><path d=\"m3.5 7 8.5 6 8.5-6\"/>",
	bell: "<path d=\"M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7 2.5 7h-17S6 15 6 9.5z\"/><path d=\"M10 20a2 2 0 0 0 4 0\"/>",
	inbox: "<path d=\"M3 13h5l1.5 2.5h5L16 13h5\"/><path d=\"M5.5 5h13L21 13v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-5z\"/>",
	server: "<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"7\" rx=\"2\"/><rect x=\"3.5\" y=\"13\" width=\"17\" height=\"7\" rx=\"2\"/><path d=\"M7.5 7.5h.01M7.5 16.5h.01\"/>",
	folder: "<path d=\"M4 6.5A2.5 2.5 0 0 1 6.5 4h3.3l2 2.2h5.7A2.5 2.5 0 0 1 20 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z\"/>",
	"folder-open": "<path d=\"M4 17.5V6.5A2.5 2.5 0 0 1 6.5 4h3.3l2 2.2h5.2A2.5 2.5 0 0 1 19.5 8.7V10\"/><path d=\"M4 17.5 6.3 11.6A2 2 0 0 1 8.2 10.3h12a1.3 1.3 0 0 1 1.2 1.8l-2.2 5.9a3 3 0 0 1-2.8 2H6.5A2.5 2.5 0 0 1 4 17.5z\"/>",
	chevron: "<path d=\"m9.5 6 6 6-6 6\"/>",
	undo: "<path d=\"M9 14 4 9l5-5\"/><path d=\"M4 9h10.5a5.5 5.5 0 0 1 0 11H11\"/>",
	redo: "<path d=\"m15 14 5-5-5-5\"/><path d=\"M20 9H9.5a5.5 5.5 0 0 0 0 11H13\"/>",
	pen: "<path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z\"/><path d=\"m14.5 5.5 3 3\"/>",
	ballpoint: "<path d=\"M18.5 3.5 20.5 5.5 9 17l-3.5 1.5L7 15z\"/><path d=\"m5.5 18.5-2 2\"/>",
	highlighter: "<path d=\"m9 11-5 5v3.5h3.5l5-5\"/><path d=\"m9 11 6.5-6.5a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L13 15z\"/><path d=\"M14 20.5h7\"/>",
	eraser: "<path d=\"m7 21-4.3-4.3a1.5 1.5 0 0 1 0-2.1l9.9-9.9a1.5 1.5 0 0 1 2.1 0l5.6 5.6a1.5 1.5 0 0 1 0 2.1L13 21\"/><path d=\"M7 21h14M5.5 12.5l6 6\"/>",
	pointer: "<path d=\"m4 4 7 17 2.5-7.5L21 11z\"/>",
	hand: "<path d=\"M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10.5V4.5a1.5 1.5 0 0 0-3 0v6M12 10.5V5.5a1.5 1.5 0 0 0-3 0V14\"/><path d=\"M18 8.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.4-2.6L3.6 15a1.5 1.5 0 0 1 2.3-1.9L9 16\"/>",
	"external-link": "<path d=\"M14 4h6v6\"/><path d=\"M20 4l-8.5 8.5\"/><path d=\"M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10\"/>",
	maximize: "<path d=\"M8 3.5H5A1.5 1.5 0 0 0 3.5 5v3M20.5 8V5A1.5 1.5 0 0 0 19 3.5h-3M16 20.5h3a1.5 1.5 0 0 0 1.5-1.5v-3M3.5 16v3A1.5 1.5 0 0 0 5 20.5h3\"/>",
	sliders: "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0\"/><circle cx=\"16\" cy=\"6\" r=\"2\"/><circle cx=\"10\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"18\" r=\"2\"/>",
	"arrow-up": "<path d=\"M12 19V5M5.5 11.5 12 5l6.5 6.5\"/>",
	"arrow-down": "<path d=\"M12 5v14M5.5 12.5 12 19l6.5-6.5\"/>",
	"folder-plus": "<path d=\"M3.5 7.5v10a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 19 8h-7l-2-2.5H5A1.5 1.5 0 0 0 3.5 7v.5\"/><path d=\"M12 11v5M9.5 13.5h5\"/>",
	upload: "<path d=\"M12 15.5V4.5M7 9l5-5 5 5\"/><path d=\"M5 19.5h14\"/>",
	columns: "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"1.5\"/><path d=\"M12 4.5v15\"/>",
	download: "<path d=\"M12 4v11M7 10.5l5 5 5-5\"/><path d=\"M5 19.5h14\"/>",
	"arrow-left": "<path d=\"M19 12H5M11 6l-6 6 6 6\"/>",
	"arrow-right": "<path d=\"M5 12h14M13 6l6 6-6 6\"/>",
	error: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m9 9 6 6M15 9l-6 6\"/>",
	warning: "<path d=\"M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z\"/><path d=\"M12 9.5v4M12 17h.01\"/>",
	pin: "<path d=\"M12 17v4.5\"/><path d=\"M9 3.5h6l-1 5.2 3.5 3.3v2H6.5v-2L10 8.7z\"/>",
	"folder-tree": "<path d=\"M13 4h2.6l1.1 1.4H20a1 1 0 0 1 1 1v2.6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z\"/><path d=\"M13 14h2.6l1.1 1.4H20a1 1 0 0 1 1 1v2.6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V15a1 1 0 0 1 1-1z\"/><path d=\"M4 3v13a2 2 0 0 0 2 2h4M4 6.5a2 2 0 0 0 2 2h4\"/>",
	"move-out": "<path d=\"M4 5v14\"/><path d=\"M20 12H8\"/><path d=\"m14 6 6 6-6 6\"/>",
	"move-in": "<path d=\"M20 5v14\"/><path d=\"M4 12h12\"/><path d=\"m10 6-6 6 6 6\"/>",
	bold: "<path d=\"M7 5h6.5a3.5 3.5 0 0 1 0 7H7z\"/><path d=\"M7 12h7.5a3.5 3.5 0 0 1 0 7H7z\"/>",
	italic: "<path d=\"M10 5h8M6 19h8M14.5 5l-5 14\"/>",
	code: "<path d=\"m9 8-4 4 4 4M15 8l4 4-4 4\"/>",
	heading: "<path d=\"M6 5v14M18 5v14M6 12h12\"/>",
	list: "<path d=\"M10 7h10M10 12h10M10 17h10\"/><circle cx=\"5\" cy=\"7\" r=\".9\"/><circle cx=\"5\" cy=\"12\" r=\".9\"/><circle cx=\"5\" cy=\"17\" r=\".9\"/>",
	"list-ordered": "<path d=\"M11 7h9M11 12h9M11 17h9\"/><path d=\"M4.5 5.5 6 4.8V9.5M4.5 15.2c.4-.5 2.4-.7 2.2.6-.2.9-2.2 1.9-2.2 2.7h2.4\"/>",
	"list-todo": "<rect x=\"3.5\" y=\"4.5\" width=\"6\" height=\"6\" rx=\"1.2\"/><path d=\"m4.8 15.8 1.6 1.6 3-3.2M13 7.5h7.5M13 16h7.5\"/>",
	quote: "<path d=\"M5 18c2.8-1.2 4-3.4 4-6.5V7H5v5h3M14 18c2.8-1.2 4-3.4 4-6.5V7h-4v5h3\"/>",
	"panel-left": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M9.5 4v16\"/>",
	close: "<path d=\"M7 7l10 10M17 7 7 17\"/>",
	edit: "<path d=\"M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z\"/>",
	trash: "<path d=\"M4 6.5h16M9.5 6.5V4.5h5v2\"/><path d=\"M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5l1-13\"/><path d=\"M10 10.5v6.5M14 10.5v6.5\"/>",
	calendar: "<rect x=\"4\" y=\"5.5\" width=\"16\" height=\"14.5\" rx=\"2\"/><path d=\"M4 10h16M8.5 3.5v4M15.5 3.5v4\"/>",
	flag: "<path d=\"M5.5 21V4.5M5.5 4.5h11l-2.5 4 2.5 4h-11\"/>",
	repeat: "<path d=\"M17 3.5 20 6.5 17 9.5\"/><path d=\"M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5 7 14.5\"/><path d=\"M20 12.5v1a4 4 0 0 1-4 4H4\"/>",
	"chevrons-up": "<path d=\"m7 11.5 5-5 5 5M7 17.5l5-5 5 5\"/>",
	"chevrons-down": "<path d=\"m7 6.5 5 5 5-5M7 12.5l5 5 5-5\"/>",
	return: "<path d=\"M19 5.5v6a3 3 0 0 1-3 3H5.5\"/><path d=\"m9 10.5-4 4 4 4\"/>",
	hash: "<path d=\"M4 9h16M4 15h16M10 3 8 21M16 3l-2 18\"/>",
	sigma: "<path d=\"M18 7V4.5H6l6 7.5-6 7.5h12V17\"/>",
	check: "<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
	circle: "<circle cx=\"12\" cy=\"12\" r=\"7.5\"/>",
	settings: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z\"/>",
	git: "<circle cx=\"6\" cy=\"6\" r=\"2.5\"/><circle cx=\"6\" cy=\"18\" r=\"2.5\"/><circle cx=\"18\" cy=\"8\" r=\"2.5\"/><path d=\"M6 8.5v7M18 10.5c0 4-6 3-10.5 6\"/>",
	"panel-bottom": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 14.5h18\"/>",
	"panel-right": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M14.5 4v16\"/>",
	outline: "<path d=\"M4 6h16M8 11h12M8 16h12M4 11h.01M4 16h.01\"/>",
	film: "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4\"/>",
	headphones: "<path d=\"M3 18v-6a9 9 0 0 1 18 0v6\"/><path d=\"M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z\"/>",
	library: "<path d=\"M5 4.5h3.5v15H5zM10.5 4.5H14v15h-3.5z\"/><path d=\"m16 5.2 3.3-.9 3.2 14.6-3.3.9z\"/>",
	scissors: "<circle cx=\"6\" cy=\"6\" r=\"2.6\"/><circle cx=\"6\" cy=\"18\" r=\"2.6\"/><path d=\"M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12\"/>",
	clipboard: "<rect x=\"5\" y=\"5\" width=\"14\" height=\"16\" rx=\"2\"/><rect x=\"9\" y=\"3\" width=\"6\" height=\"4\" rx=\"1\"/>",
	"select-all": "<path d=\"M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1\"/><rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\"/>",
	copy: "<rect x=\"8.5\" y=\"8.5\" width=\"11.5\" height=\"11.5\" rx=\"2.2\"/><path d=\"M15.5 8.5V6A2 2 0 0 0 13.5 4h-7.5A2 2 0 0 0 4 6v7.5a2 2 0 0 0 2 2h2.5\"/>",
	graph: "<circle cx=\"6\" cy=\"6\" r=\"2.2\"/><circle cx=\"18\" cy=\"7.5\" r=\"2.2\"/><circle cx=\"12\" cy=\"18\" r=\"2.2\"/><path d=\"M8.2 6.4l7.6.9M7.1 8l3.8 7.9M16.9 9.5l-3.8 6.6\"/>",
	link: "<path d=\"M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1 1\"/><path d=\"M14 10a4.5 4.5 0 0 0-6.4 0l-3 3A4.5 4.5 0 0 0 11 19.4l1-1\"/>",
	grid: "<rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/>",
	rows: "<path d=\"M8.5 6h11.5M8.5 12h11.5M8.5 18h11.5\"/><circle cx=\"4.5\" cy=\"6\" r=\".9\"/><circle cx=\"4.5\" cy=\"12\" r=\".9\"/><circle cx=\"4.5\" cy=\"18\" r=\".9\"/>",
	table: "<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.5\"/><path d=\"M3 9.5h18M3 15h18M9.5 9.5V20\"/>",
	chart: "<path d=\"M3.5 3.5v17h17\"/><path d=\"m7 15 4-5 3.5 3L20 6.5\"/>",
	"chevron-down": "<path d=\"m6 9 6 6 6-6\"/>",
	commit: "<circle cx=\"12\" cy=\"12\" r=\"3.5\"/><path d=\"M3 12h5.5M15.5 12H21\"/>",
	clock: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>",
	sun: "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4\"/>",
	eye: "<path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
	moon: "<path d=\"M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z\"/>",
	plus: "<path d=\"M12 5v14M5 12h14\"/>",
	minus: "<path d=\"M5 12h14\"/>",
	more: "<circle cx=\"12\" cy=\"5.5\" r=\"0.9\"/><circle cx=\"12\" cy=\"12\" r=\"0.9\"/><circle cx=\"12\" cy=\"18.5\" r=\"0.9\"/>",
	refresh: "<path d=\"M20 11.5A8 8 0 0 0 6 6.6L4 8.5M4 4v4.5h4.5M4 12.5A8 8 0 0 0 18 17.4l2-1.9M20 20v-4.5h-4.5\"/>",
	zoom: "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m20 20-4.3-4.3M8.5 11h5M11 8.5v5\"/>",
	contents: "<path d=\"M9 6h11M9 12h11M9 18h11\"/><circle cx=\"4.5\" cy=\"6\" r=\"1\"/><circle cx=\"4.5\" cy=\"12\" r=\"1\"/><circle cx=\"4.5\" cy=\"18\" r=\"1\"/>",
	pages: "<rect x=\"7\" y=\"3\" width=\"13\" height=\"15\" rx=\"2\"/><path d=\"M4 7v11.5A2.5 2.5 0 0 0 6.5 21H16\"/>",
	bookmark: "<path d=\"M18 21l-6-4-6 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z\"/>",
	notes: "<path d=\"M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8z\"/><path d=\"M15 3v4a2 2 0 0 0 2 2h4M7.5 13h7M7.5 17h4\"/>",
	text: "<path d=\"M6 4h12\"/><path d=\"M12 4v16\"/>",
	underline: "<path d=\"M6.5 4v6a5.5 5.5 0 0 0 11 0V4\"/><path d=\"M4.5 20.5h15\"/>",
	strike: "<path d=\"M16 5.5c-.8-1.3-2.3-2-4.2-2-2.6 0-4.3 1.4-4.3 3.3 0 1.4.8 2.4 2.5 3.2\"/><path d=\"M8 17.5c.8 1.6 2.3 2.5 4.3 2.5 2.7 0 4.5-1.5 4.5-3.6 0-.9-.3-1.7-1-2.4\"/><path d=\"M3.5 12h17\"/>",
	sticky: "<path d=\"M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z\"/><path d=\"M15 3v6h6\"/>",
	crop: "<path d=\"M6 2.5V16a2 2 0 0 0 2 2h13.5\"/><path d=\"M18 21.5V8a2 2 0 0 0-2-2H2.5\"/>",
	stamp: "<path d=\"m12 2.5 2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5-4.8-4.6 6.6-1z\"/>"
}, Oa = (e) => Object.hasOwn(Da, e);
function ka(e, t = 16) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Da[e]}</svg>`;
}
//#endregion
//#region ui/src/components/Icon.svelte
var Aa = /* @__PURE__ */ q("<span class=\"icon svelte-1yrfdk4\"></span>"), ja = {
	hash: "svelte-1yrfdk4",
	code: "\n  /* sized by the interface's scale (Settings → font size, a tab's zoom), as the text beside it */.icon.svelte-1yrfdk4 {display:inline-flex;align-items:center;justify-content:center;flex:none;line-height:0;}.icon.svelte-1yrfdk4 svg {width:100%;height:100%;}"
};
function Ma(e, t) {
	We(t, !0), ii(e, ja);
	let n = qi(t, "size", 3, 16);
	var r = Aa();
	let i;
	ri(r, () => ka(t.name, n()), !0), k(r), H(() => i = gi(r, "", i, {
		width: `calc(${n() ?? ""}px * var(--ui-scale, 1))`,
		height: `calc(${n() ?? ""}px * var(--ui-scale, 1))`
	})), J(e, r), Ge();
}
//#endregion
//#region plugins/beta/catalog/ui/src/Icon.svelte
function Na(e, t) {
	We(t, !0);
	let n = qi(t, "size", 3, 16);
	{
		let r = /* @__PURE__ */ P(() => Oa(t.name) ? t.name : "library");
		Ma(e, {
			get name() {
				return G(r);
			},
			get size() {
				return n();
			}
		});
	}
	Ge();
}
//#endregion
//#region plugins/beta/catalog/ui/src/LibraryCover.svelte
var Pa = /* @__PURE__ */ q("<img alt=\"\"/>"), Fa = /* @__PURE__ */ q("<div aria-hidden=\"true\"> </div>"), Ia = /* @__PURE__ */ q("<div><!></div>"), La = {
	hash: "svelte-enia8e",
	code: ".cover.svelte-enia8e {width:100%;aspect-ratio:2 / 3;object-fit:cover;border-radius:var(--radius-sm);background:var(--bg-alt);box-shadow:var(--shadow-sm);}.cover.big.svelte-enia8e {aspect-ratio:auto;max-height:280px;width:auto;max-width:100%;margin-bottom:10px;}.tile.svelte-enia8e {display:grid;place-items:center;font-size:2.2em;font-weight:600;box-shadow:none;background:hsl(var(--hue) 32% 50% / .22);color:hsl(var(--hue) 40% 42%);} /* literal: a hue per title */\n  /* the panel's: a tile its column's width while the picture is missing or on its way, not a blank column */.tile.big.svelte-enia8e {aspect-ratio:2 / 3;width:100%;max-height:240px;font-size:3em;}.wrap.svelte-enia8e {width:100%;min-height:1px;}"
};
function Ra(e, t) {
	We(t, !0), ii(e, La);
	let n = qi(t, "big", 3, !1), r = /* @__PURE__ */ I(null), i = /* @__PURE__ */ I(void 0);
	async function a(e) {
		let r = typeof e == "function" ? await e() : e;
		return r ? /^(https?:|data:|blob:)/i.test(r) ? r : t.kandinsky.thumbUrl(r.replace(/^!?\[\[|\]\]$/g, "").split("|")[0], n() ? 520 : 260) : null;
	}
	_n(() => {
		let e = t.cover, n = G(i);
		if (!n) return;
		let o = !0;
		L(r, null);
		let s = new IntersectionObserver((t) => {
			t.some((e) => e.isIntersecting) && (s.disconnect(), a(e).then((e) => {
				o && L(r, e, !0);
			}, () => {}));
		}, { rootMargin: "400px" });
		return s.observe(n), () => {
			o = !1, s.disconnect();
		};
	});
	let o = /* @__PURE__ */ P(() => t.title.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?"), s = /* @__PURE__ */ P(() => [...t.title].reduce((e, t) => (e * 31 + t.charCodeAt(0)) % 360, 7));
	var c = Ia();
	let l;
	var u = z(c), d = (e) => {
		var t = Pa();
		let i;
		H(() => {
			i = Q(t, 1, "cover svelte-enia8e", null, i, { big: n() }), $(t, "src", G(r));
		}), J(e, t);
	}, f = (e) => {
		var t = Fa();
		let r, i;
		var a = B(t, !0);
		H(() => {
			r = Q(t, 1, "cover tile svelte-enia8e", null, r, { big: n() }), i = gi(t, "", i, { "--hue": G(s) }), Y(a, G(o));
		}), J(e, t);
	};
	X(u, (e) => {
		G(r) ? e(d) : e(f, -1);
	}), k(c), Wi(c, (e) => L(i, e), () => G(i)), H(() => l = Q(c, 1, "wrap svelte-enia8e", null, l, { big: n() })), J(e, c), Ge();
}
//#endregion
//#region plugins/beta/catalog/ui/src/Library.svelte
var za = /* @__PURE__ */ q("<button><!> </button>"), Ba = /* @__PURE__ */ q("<div class=\"drop-hint svelte-7gk24t\"> </div>"), Va = /* @__PURE__ */ q("<button role=\"radio\"> </button>"), Ha = /* @__PURE__ */ q("<div class=\"seg svelte-7gk24t\" role=\"radiogroup\" aria-label=\"Layout\"></div>"), Ua = /* @__PURE__ */ q("<button class=\"btn home svelte-7gk24t\"><!> <!></button>"), Wa = /* @__PURE__ */ q("<form class=\"add svelte-7gk24t\"><input spellcheck=\"false\" class=\"svelte-7gk24t\"/> <button class=\"btn primary svelte-7gk24t\"> </button></form>"), Ga = /* @__PURE__ */ q("<button> <span class=\"c svelte-7gk24t\"> </span></button>"), Ka = /* @__PURE__ */ q("<div class=\"types svelte-7gk24t\" role=\"toolbar\" aria-label=\"Type\"><button>All <span class=\"c svelte-7gk24t\"> </span></button> <!></div>"), qa = /* @__PURE__ */ q("<button class=\"btn primary svelte-7gk24t\"> </button>"), Ja = /* @__PURE__ */ q("<p class=\"muted pad svelte-7gk24t\"> <!></p>"), Ya = /* @__PURE__ */ q("<span class=\"bar svelte-7gk24t\"></span>"), Xa = /* @__PURE__ */ q("<button class=\"go svelte-7gk24t\"><!> <span class=\"t svelte-7gk24t\"></span> <!></button>"), Za = /* @__PURE__ */ q("<section class=\"continue svelte-7gk24t\" aria-label=\"Continue\"><h4 class=\"svelte-7gk24t\">Continue</h4> <div class=\"strip svelte-7gk24t\"></div></section>"), Qa = /* @__PURE__ */ q("<button class=\"twisty svelte-7gk24t\"><!></button>"), $a = /* @__PURE__ */ q("<span class=\"twisty svelte-7gk24t\"></span>"), eo = /* @__PURE__ */ q("<div class=\"tree-row svelte-7gk24t\"><!> <button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button></div>"), to = /* @__PURE__ */ q("<button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button>"), no = /* @__PURE__ */ q("<h4 class=\"svelte-7gk24t\"> </h4> <!>", 1), ro = /* @__PURE__ */ q("<button><span class=\"hash svelte-7gk24t\">#</span><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button>"), io = /* @__PURE__ */ q("<button class=\"h4 svelte-7gk24t\"><!>Tags <span class=\"c svelte-7gk24t\"> </span></button> <!>", 1), ao = /* @__PURE__ */ q("<nav class=\"side svelte-7gk24t\"><button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button> <!> <!></nav>"), oo = /* @__PURE__ */ q("<th scope=\"col\"><button type=\"button\" class=\"th-btn svelte-7gk24t\"><span class=\"svelte-7gk24t\"> </span><span class=\"sort-ind svelte-7gk24t\" aria-hidden=\"true\"> </span></button></th>"), so = /* @__PURE__ */ q("<span class=\"flag red svelte-7gk24t\">PDF</span>"), co = /* @__PURE__ */ q("<tr><td class=\"c-title svelte-7gk24t\"><button type=\"button\" class=\"row-focus svelte-7gk24t\"><span class=\"t svelte-7gk24t\"></span></button></td><td class=\"c-author svelte-7gk24t\"> </td><td class=\"c-year svelte-7gk24t\"> </td><td class=\"c-venue svelte-7gk24t\"> </td><td class=\"c-kind svelte-7gk24t\"> </td><td class=\"c-added svelte-7gk24t\"> </td><td class=\"c-pdf svelte-7gk24t\"><!></td></tr>"), lo = /* @__PURE__ */ q("<div class=\"sr-only svelte-7gk24t\" role=\"status\"> </div> <table class=\"zot-table svelte-7gk24t\"><caption class=\"sr-only svelte-7gk24t\"> </caption><thead class=\"svelte-7gk24t\"><tr></tr></thead><tbody></tbody></table>", 1), uo = /* @__PURE__ */ q("<button class=\"btn from-home svelte-7gk24t\"> <!></button>"), fo = /* @__PURE__ */ q("<div class=\"from-head svelte-7gk24t\" role=\"heading\" aria-level=\"3\"><!><span class=\"fh svelte-7gk24t\"> </span> <span class=\"fc svelte-7gk24t\"> </span> <!></div>"), po = /* @__PURE__ */ q("<span class=\"m svelte-7gk24t\"> </span>"), mo = /* @__PURE__ */ q("<button><!> <!> <span class=\"t svelte-7gk24t\"></span> <!></button>"), ho = /* @__PURE__ */ q("<span> </span>"), go = /* @__PURE__ */ q("<span class=\"flags svelte-7gk24t\"></span>"), _o = /* @__PURE__ */ q("<button><span class=\"t svelte-7gk24t\"></span> <!> <!> <!></button>"), vo = /* @__PURE__ */ q("<!> <!> >>>>>>> theirs", 1), yo = /* @__PURE__ */ q("<p class=\"muted pad none svelte-7gk24t\"> <!></p>"), bo = /* @__PURE__ */ q("<li class=\"svelte-7gk24t\"></li>"), xo = /* @__PURE__ */ q("<li class=\"muted svelte-7gk24t\"> </li>"), So = /* @__PURE__ */ q("<aside class=\"detail many svelte-7gk24t\" aria-label=\"Picked\"><div class=\"kind svelte-7gk24t\"> </div> <ul class=\"picked svelte-7gk24t\"><!><!></ul> <div class=\"actions svelte-7gk24t\"><!><button class=\"btn svelte-7gk24t\">Clear</button></div></aside>"), Co = /* @__PURE__ */ q("<button class=\"scrim svelte-7gk24t\" aria-label=\"Close\"></button>"), wo = /* @__PURE__ */ q("<button class=\"close icon-btn svelte-7gk24t\" aria-label=\"Close\" title=\"Close\"><!></button>"), To = /* @__PURE__ */ q("<span class=\"hint svelte-7gk24t\"> </span>"), Eo = /* @__PURE__ */ q("<textarea class=\"svelte-7gk24t\"></textarea>"), Do = /* @__PURE__ */ q("<input class=\"svelte-7gk24t\"/>"), Oo = /* @__PURE__ */ q("<label> <!> <!></label>"), ko = /* @__PURE__ */ q("<form class=\"edit svelte-7gk24t\"><!> <div class=\"actions svelte-7gk24t\"><button class=\"btn primary svelte-7gk24t\">Save</button><button type=\"button\" class=\"btn svelte-7gk24t\">Cancel</button></div></form>"), Ao = /* @__PURE__ */ q("<div class=\"kind svelte-7gk24t\"> </div>"), jo = /* @__PURE__ */ q("<p> </p>"), Mo = /* @__PURE__ */ q("<button class=\"btn svelte-7gk24t\" aria-label=\"More\"><!></button>"), No = /* @__PURE__ */ q("<div class=\"facts-pic svelte-7gk24t\"><!></div>"), Po = /* @__PURE__ */ q("<dt class=\"svelte-7gk24t\"> </dt><dd class=\"svelte-7gk24t\"> </dd>", 1), Fo = /* @__PURE__ */ q("<dl class=\"svelte-7gk24t\"></dl>"), Io = /* @__PURE__ */ q("<div><!> <!></div>"), Lo = /* @__PURE__ */ q("<div class=\"choice svelte-7gk24t\" role=\"radiogroup\"><span class=\"svelte-7gk24t\"> </span> <!></div>"), Ro = /* @__PURE__ */ q("<a target=\"_blank\" rel=\"noreferrer\" class=\"svelte-7gk24t\"><!> </a>"), zo = /* @__PURE__ */ q("<div class=\"links svelte-7gk24t\"></div>"), Bo = /* @__PURE__ */ q("<button class=\"tag coll svelte-7gk24t\"><!> </button>"), Vo = /* @__PURE__ */ q("<button class=\"tag svelte-7gk24t\"> </button>"), Ho = /* @__PURE__ */ q("<div class=\"tags svelte-7gk24t\"><!> <!></div>"), Uo = /* @__PURE__ */ q("<h3 class=\"svelte-7gk24t\"> </h3><p class=\"abstract svelte-7gk24t\"> </p>", 1), Wo = /* @__PURE__ */ q("<h3 class=\"svelte-7gk24t\">Your notes</h3><p class=\"abstract own svelte-7gk24t\"> </p><button class=\"kandinsky-btn more-notes svelte-7gk24t\">Open the notes</button>", 1), Go = /* @__PURE__ */ q("<div></div>"), Ko = /* @__PURE__ */ q("<div class=\"links-bar svelte-7gk24t\"><!></div>"), qo = /* @__PURE__ */ q("<!> <aside class=\"detail svelte-7gk24t\"><!> <!> <!> <h2 class=\"svelte-7gk24t\"></h2> <!> <div class=\"actions svelte-7gk24t\"><!> <!></div> <!> <!> <!> <!> <!> <!> <!></aside>", 1), Jo = /* @__PURE__ */ q("<aside class=\"detail none svelte-7gk24t\" aria-label=\"Details\"><p> <span class=\"keys-only\"><br/>↑ ↓ move, Enter opens.</span></p></aside>"), Yo = /* @__PURE__ */ q("<div tabindex=\"0\" role=\"application\"><!> <header class=\"svelte-7gk24t\"><h1 class=\"svelte-7gk24t\"><!> <span class=\"count svelte-7gk24t\"> </span></h1> <input class=\"search svelte-7gk24t\" spellcheck=\"false\"/> <!> <!> <!> <!> <!></header> <!> <!> <!> <div><!> <div><!></div> <!></div></div>"), Xo = {
	hash: "svelte-7gk24t",
	code: ".types.svelte-7gk24t {display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px;}.chip.svelte-7gk24t {display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--border);color:var(--text-muted);font-size:calc(12.5px * var(--ui-scale, 1));}.chip.svelte-7gk24t:hover {background:var(--bg-hover);color:var(--text);}.chip.on.svelte-7gk24t {background:var(--accent-soft);border-color:color-mix(in srgb, var(--accent) 45%, transparent);color:var(--accent);}.chip.svelte-7gk24t .c:where(.svelte-7gk24t) {color:var(--text-faint);font-variant-numeric:tabular-nums;}.library.svelte-7gk24t {height:100%;display:flex;flex-direction:column;background:var(--bg);outline:none;position:relative;}.library.dragging.svelte-7gk24t {box-shadow:inset 0 0 0 2px var(--accent);}.drop-hint.svelte-7gk24t {position:absolute;inset:0;z-index:5;display:grid;place-items:center;pointer-events:none;background:color-mix(in srgb, var(--bg) 70%, transparent);color:var(--accent);font-size:calc(16px * var(--ui-scale, 1));font-weight:600;}header.svelte-7gk24t {display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border);}h1.svelte-7gk24t {display:inline-flex;gap:8px;align-items:center;margin:0 8px 0 0;font-size:calc(17px * var(--ui-scale, 1));color:var(--heading);}.count.svelte-7gk24t {font-size:.7em;font-weight:500;color:var(--text-faint);}input.svelte-7gk24t {font:inherit;font-size:calc(13px * var(--ui-scale, 1));color:var(--text);background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:5px 9px;}input.svelte-7gk24t:focus {outline:none;border-color:var(--accent);}.search.svelte-7gk24t {flex:1;min-width:220px;}.add.svelte-7gk24t {display:flex;gap:6px;}.add.svelte-7gk24t input:where(.svelte-7gk24t) {width:270px;} /* the placeholder whole (clipped text is a bug) */.seg.svelte-7gk24t {display:inline-flex;border:1px solid var(--border-strong);border-radius:var(--radius-sm);overflow:hidden;}.seg.svelte-7gk24t button:where(.svelte-7gk24t) {padding:4px 10px;color:var(--text-muted);}.seg.svelte-7gk24t button.on:where(.svelte-7gk24t) {background:var(--accent-soft);color:var(--accent);}.btn.svelte-7gk24t {display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border-strong);}.btn.svelte-7gk24t:hover:not(:disabled) {background:var(--bg-hover);}.btn.svelte-7gk24t:disabled {opacity:.45;cursor:default;}.btn.danger.svelte-7gk24t {color:var(--red);}.edit.svelte-7gk24t {display:grid;grid-template-columns:1fr 2fr;gap:8px;margin:0 0 14px;padding:12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-alt);}.edit.svelte-7gk24t label:where(.svelte-7gk24t) {grid-column:1 / -1;display:flex;flex-direction:column;gap:3px;color:var(--text-muted);font-size:calc(12px * var(--ui-scale, 1));}.edit.svelte-7gk24t label.half:where(.svelte-7gk24t) {grid-column:auto;}.edit.svelte-7gk24t .actions:where(.svelte-7gk24t) {grid-column:1 / -1;}.edit.svelte-7gk24t textarea:where(.svelte-7gk24t) {font:inherit;font-size:calc(13px * var(--ui-scale, 1));color:var(--text);background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:5px 9px;resize:vertical;}.hint.svelte-7gk24t {color:var(--text-faint);font-weight:400;}.body.svelte-7gk24t {flex:1;min-height:0;display:grid;grid-template-columns:210px minmax(300px, 1.15fr) minmax(280px, 1fr);}.body.bare.svelte-7gk24t {grid-template-columns:minmax(300px, 1.4fr) minmax(280px, 1fr);}.list.empty-list.svelte-7gk24t {grid-column:span 2;} /* nothing to list: its words get the detail's column too */.detail.none.svelte-7gk24t {display:grid;place-content:center;text-align:center;color:var(--text-faint);}.side.svelte-7gk24t {overflow:auto;border-right:1px solid var(--border);padding:8px 6px;background:var(--bg-alt);display:flex;flex-direction:column;gap:1px;}.side.svelte-7gk24t h4:where(.svelte-7gk24t), .side.svelte-7gk24t .h4:where(.svelte-7gk24t) {display:flex;align-items:center;gap:4px;margin:12px 8px 4px;padding:0;font-size:calc(10.5px * var(--ui-scale, 1));font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);text-align:left;}.side.svelte-7gk24t .h4:where(.svelte-7gk24t):hover {color:var(--text);}.item.svelte-7gk24t {display:flex;align-items:center;gap:7px;width:100%;padding:4px 8px;border-radius:var(--radius-sm);color:var(--text);text-align:left;font-size:calc(12.5px * var(--ui-scale, 1));}.item.svelte-7gk24t:hover {background:var(--bg-hover);}.item.on.svelte-7gk24t {background:var(--accent-soft);color:var(--heading);box-shadow:inset 2px 0 0 var(--accent);}.item.drop.svelte-7gk24t {outline:2px dashed var(--accent);outline-offset:-2px;background:var(--accent-soft);}.item.svelte-7gk24t .n:where(.svelte-7gk24t) {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.c.svelte-7gk24t {color:var(--text-faint);font-size:.85em;font-variant-numeric:tabular-nums;}.hash.svelte-7gk24t {color:var(--text-faint);width:14px;text-align:center;}.tagitem.svelte-7gk24t {color:var(--text-muted);}.tag.coll.svelte-7gk24t {display:inline-flex;gap:4px;align-items:center;color:var(--text);}.list.svelte-7gk24t {overflow:hidden auto; /* the grid wraps: a horizontal offset only ever hid the first column */border-right:1px solid var(--border);padding:6px;position:relative;user-select:none;-webkit-user-select:none;}.list.svelte-7gk24t .marquee {position:absolute;z-index:2;pointer-events:none;border:1px solid var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent);border-radius:2px;}.tree-row.svelte-7gk24t {display:flex;align-items:center;min-width:0;}.tree-row.svelte-7gk24t .item:where(.svelte-7gk24t) {flex:1;min-width:0;}.twisty.svelte-7gk24t {flex:none;width:16px;height:22px;display:grid;place-items:center;color:var(--text-faint);padding:0;}.twisty.svelte-7gk24t:hover {color:var(--text);}.picked.svelte-7gk24t {margin:8px 0 12px;padding-left:18px;font-size:.9em;color:var(--text-muted);}.picked.svelte-7gk24t li:where(.svelte-7gk24t) {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.list.covers.svelte-7gk24t {display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:16px 14px;align-content:start;padding:14px;}.sr-only.svelte-7gk24t {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;}.list.table-mode.svelte-7gk24t {padding:0;overflow:auto;}.zot-table.svelte-7gk24t {width:100%;border-collapse:collapse;table-layout:fixed;font-size:calc(12.5px * var(--ui-scale, 1));}.zot-table.svelte-7gk24t thead:where(.svelte-7gk24t) th:where(.svelte-7gk24t) {position:sticky;top:0;z-index:1;background:var(--bg-alt);border-bottom:1px solid var(--border-strong);padding:0;text-align:left;font-weight:600;color:var(--text-muted);}.th-btn.svelte-7gk24t {width:100%;display:flex;align-items:center;gap:4px;padding:7px 8px;text-align:left;font:inherit;font-size:calc(11.5px * var(--ui-scale, 1));color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.th-btn.svelte-7gk24t:hover {background:var(--bg-hover);color:var(--text);}.sort-ind.svelte-7gk24t {color:var(--accent);flex:none;}.col-title.svelte-7gk24t {width:34%;}.col-author.svelte-7gk24t {width:19%;}.col-year.svelte-7gk24t {width:58px;}.col-venue.svelte-7gk24t {width:18%;}.col-kind.svelte-7gk24t {width:10%;}.col-added.svelte-7gk24t {width:88px;}.col-pdf.svelte-7gk24t {width:48px;}.trow.svelte-7gk24t {cursor:pointer;}.trow.svelte-7gk24t td:where(.svelte-7gk24t) {padding:6px 8px;border-bottom:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);vertical-align:middle;}.trow.svelte-7gk24t:hover td:where(.svelte-7gk24t) {background:var(--bg-hover);}.trow.sel.svelte-7gk24t td:where(.svelte-7gk24t) {background:var(--accent-soft);}.trow.sel.svelte-7gk24t td:where(.svelte-7gk24t):first-child {box-shadow:inset 2px 0 0 var(--accent);}.row-focus.svelte-7gk24t {display:block;width:100%;text-align:left;padding:0;font:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.row-focus.svelte-7gk24t .t:where(.svelte-7gk24t) {display:block;}.c-year.svelte-7gk24t, .c-added.svelte-7gk24t {font-variant-numeric:tabular-nums;}.c-pdf.svelte-7gk24t {text-align:center;}\n  /* a service's things, apart from the vault's: a band across the list with the way into the service's own app */.from-head.svelte-7gk24t {grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin:14px 0 2px;padding:8px 10px;border-radius:var(--radius-sm);background:var(--bg-alt);border:1px solid var(--border);color:var(--text-muted);font-size:calc(12px * var(--ui-scale, 1));}.from-head.svelte-7gk24t:first-child {margin-top:0;}.from-head.svelte-7gk24t .fh:where(.svelte-7gk24t) {font-weight:600;letter-spacing:.02em;color:var(--heading);}.from-head.svelte-7gk24t .fc:where(.svelte-7gk24t) {color:var(--text-faint);font-variant-numeric:tabular-nums;}.home.svelte-7gk24t {display:inline-flex;align-items:center;gap:6px;}.from-home.svelte-7gk24t {margin-left:auto;display:inline-flex;align-items:center;gap:5px;}.mine-none.svelte-7gk24t {grid-column:1 / -1;margin:4px 2px 0;color:var(--text-muted);}.row.svelte-7gk24t {display:grid;grid-template-columns:minmax(0, 1fr) auto;gap:2px 10px;width:100%;text-align:left;padding:8px 10px;border-radius:var(--radius-sm);}.row.svelte-7gk24t:hover {background:var(--bg-hover);}.row.sel.svelte-7gk24t {background:var(--accent-soft);box-shadow:inset 2px 0 0 var(--accent);}.card.svelte-7gk24t {display:flex;flex-direction:column;gap:4px;text-align:left;padding:4px;border-radius:var(--radius-sm);min-width:0;}\n  /* a library of thousands: items out of view are not laid out or painted (still in the page, for the marquee and keys) */.row.svelte-7gk24t {content-visibility:auto;contain-intrinsic-size:auto 52px;}\n  /* never a card: its height (a cover's 2:3 at the column's width, then two lines) is not one number, and WebKit kept\n     the guessed one for cards laid out again after the pane came back (titles drawn over the covers); covers already\n     load only near the view (LibraryCover) */.card.svelte-7gk24t:hover {background:var(--bg-hover);}.card.sel.svelte-7gk24t {background:var(--accent-soft);box-shadow:0 0 0 2px var(--accent);}.card.svelte-7gk24t .t:where(.svelte-7gk24t) {font-size:.92em;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;}.card.svelte-7gk24t .m:where(.svelte-7gk24t) {font-size:.8em;}.t.svelte-7gk24t {grid-column:1;color:var(--heading);font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.m.svelte-7gk24t {grid-column:1;color:var(--text-muted);font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n  /* how far along: a thin bar, the done part in the accent */.bar.svelte-7gk24t {display:block;height:3px;border-radius:2px;background:linear-gradient(to right, var(--accent) calc(var(--p) * 100%), var(--border) 0);}.row.svelte-7gk24t .bar:where(.svelte-7gk24t) {grid-column:1 / -1;margin-top:3px;}.continue.svelte-7gk24t {flex:none;padding:8px 16px 10px;border-bottom:1px solid var(--border);}.continue.svelte-7gk24t h4:where(.svelte-7gk24t) {margin:0 0 6px;font-size:calc(10.5px * var(--ui-scale, 1));font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);}.strip.svelte-7gk24t {display:flex;gap:12px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;}.go.svelte-7gk24t {flex:none;width:104px;display:flex;flex-direction:column;gap:4px;padding:3px;border-radius:var(--radius-sm);text-align:left;}.go.svelte-7gk24t:hover {background:var(--bg-hover);}.go.svelte-7gk24t .t:where(.svelte-7gk24t) {font-size:.82em;font-weight:500;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;}.narrow.svelte-7gk24t .continue:where(.svelte-7gk24t) {padding:6px 12px 8px;}.flags.svelte-7gk24t {grid-column:2;grid-row:1 / span 2;display:flex;gap:4px;align-items:center;}.flag.svelte-7gk24t {font-size:calc(11px * var(--ui-scale, 1));padding:1px 6px;border-radius:999px;background:var(--bg-hover);color:var(--text-muted);}.flag.red.svelte-7gk24t {color:var(--red);background:color-mix(in srgb, var(--red) 14%, transparent);}\n  /* a column; the linked mentions follow the item (at the bottom of a short card they stood apart, the column blank) */.detail.svelte-7gk24t {overflow:auto;padding:18px 22px 40px;display:flex;flex-direction:column;container-type:inline-size;}.detail.svelte-7gk24t > * {flex-shrink:0;}.facts.svelte-7gk24t {display:grid;gap:14px;margin:8px 0 4px;}\n  /* the picture a fixed, modest width: the fields get the rest (beside a 42 % picture they broke letter by letter) */.facts.pic.svelte-7gk24t {grid-template-columns:120px minmax(0, 1fr);align-items:start;}.facts-pic.svelte-7gk24t .cover.big {width:120px;}.facts-pic.svelte-7gk24t .cover.big {max-height:240px;margin:0;}.facts.svelte-7gk24t dl:where(.svelte-7gk24t) {margin:0;}.narrow.svelte-7gk24t .facts.pic:where(.svelte-7gk24t) {grid-template-columns:96px minmax(0, 1fr);}\n  /* a narrow panel (the usual ~300 px column): the picture on its own line, the fields the panel's whole width —\n     beside it the values broke inside words */\n  @container (max-width: 460px) {.facts.pic.svelte-7gk24t {grid-template-columns:minmax(0, 1fr);}.facts-pic.svelte-7gk24t .cover.big {width:auto;max-width:140px;max-height:190px;}\n  }\n  /* the mentions follow the item, open (an item's panel is where they matter), never pinned under an empty column */.links-bar.svelte-7gk24t {margin:22px -22px 0;padding-top:4px;display:flex;flex-direction:column;}.abstract.own.svelte-7gk24t {white-space:pre-line;}.more-notes.svelte-7gk24t {align-self:flex-start;margin-top:4px;}.kind.svelte-7gk24t {text-transform:uppercase;letter-spacing:.07em;font-size:calc(11px * var(--ui-scale, 1));color:var(--text-faint);}h2.svelte-7gk24t {margin:4px 0 6px;font-size:calc(19px * var(--ui-scale, 1));color:var(--heading);line-height:1.3;}.authors.svelte-7gk24t {margin:0;color:var(--text);}.venue.svelte-7gk24t {margin:2px 0 0;color:var(--text-muted);font-style:italic;}dl.svelte-7gk24t {display:grid;grid-template-columns:max-content minmax(0, 1fr);gap:3px 12px;font-size:.9em;margin:10px 0;}dt.svelte-7gk24t {color:var(--text-faint);}dd.svelte-7gk24t {margin:0;overflow-wrap:anywhere;}.actions.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 8px;}.choice.svelte-7gk24t {display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 10px;}.choice.svelte-7gk24t span:where(.svelte-7gk24t) {color:var(--text-faint);font-size:.85em;margin-right:2px;}.links.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:14px;margin:6px 0;}.links.svelte-7gk24t a:where(.svelte-7gk24t) {display:inline-flex;gap:5px;align-items:center;color:var(--link, var(--accent));text-decoration:none;font-size:.92em;}.links.svelte-7gk24t a:where(.svelte-7gk24t):hover {text-decoration:underline;}.tags.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}.tag.svelte-7gk24t {font-size:calc(11.5px * var(--ui-scale, 1));padding:2px 9px;border-radius:999px;border:1px solid var(--border-strong);color:var(--text-muted);}.tag.svelte-7gk24t:hover {color:var(--text);border-color:var(--accent);}h3.svelte-7gk24t {margin:18px 0 6px;font-size:calc(11px * var(--ui-scale, 1));text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);}.abstract.svelte-7gk24t {margin:0;line-height:1.6;color:var(--text);}.pad.svelte-7gk24t {padding:12px 16px;}\n  /* the covers are a grid: the \"nothing here\" line spans all its columns (on a phone it sat in one, a word a line) */.list.svelte-7gk24t .none:where(.svelte-7gk24t) {grid-column:1 / -1;} /* only the list's: the detail's empty column must stay in its own column */\n\n  /* narrow: one column; groups as a row of chips; the card as a sheet over the list */.narrow.svelte-7gk24t header:where(.svelte-7gk24t) {padding:10px 12px;gap:8px;}.narrow.svelte-7gk24t .search:where(.svelte-7gk24t) {flex:1 1 100%;min-width:0;order:1;}.narrow.svelte-7gk24t .add:where(.svelte-7gk24t) {flex:1 1 100%;order:2;}.narrow.svelte-7gk24t .add:where(.svelte-7gk24t) input:where(.svelte-7gk24t) {flex:1;width:auto;min-width:0;}.narrow.svelte-7gk24t .types:where(.svelte-7gk24t) {padding:0 12px 8px;flex-wrap:nowrap;overflow-x:auto;}.narrow.svelte-7gk24t .body:where(.svelte-7gk24t), .narrow.svelte-7gk24t .body.bare:where(.svelte-7gk24t) {display:flex;flex-direction:column;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) {flex:none;flex-direction:row;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--border);padding:6px 12px;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) h4:where(.svelte-7gk24t), .narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .h4:where(.svelte-7gk24t) {margin:0 2px 0 6px;flex:none;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .item:where(.svelte-7gk24t) {width:auto;flex:none;max-width:70vw;padding:5px 10px;border-radius:999px;border:1px solid var(--border);}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .item.on:where(.svelte-7gk24t) {box-shadow:none;border-color:color-mix(in srgb, var(--accent) 45%, transparent);}.narrow.svelte-7gk24t .list:where(.svelte-7gk24t) {flex:1;border-right:0;}.narrow.svelte-7gk24t .zot-table:where(.svelte-7gk24t) {min-width:640px;}.narrow.svelte-7gk24t .list.covers:where(.svelte-7gk24t) {grid-template-columns:repeat(auto-fill, minmax(104px, 1fr));gap:12px 10px;padding:10px 12px;}.scrim.svelte-7gk24t {position:absolute;inset:0;z-index:6;background:var(--scrim);border:0;padding:0;cursor:default;}.narrow.svelte-7gk24t .detail:where(.svelte-7gk24t) {position:absolute;left:0;right:0;bottom:0;z-index:7;max-height:80%;padding:18px 16px calc(24px + env(safe-area-inset-bottom, 0px));background:var(--bg-elev);border-top:1px solid var(--border-strong);border-radius:14px 14px 0 0;box-shadow:var(--shadow-pop);}.narrow.svelte-7gk24t .detail:where(.svelte-7gk24t) .cover.big {max-height:180px;}\n  /* stays at the sheet's top right while its card scrolls */.close.svelte-7gk24t {position:sticky;top:0;float:right;z-index:1;margin:-8px -6px 0 8px;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:var(--bg-hover);}"
};
function Zo(e, t) {
	We(t, !0), ii(e, Xo);
	let n = (e, t = d) => {
		var n = za();
		let r;
		var i = z(n), a = (e) => {
			Na(e, {
				get name() {
					return t().icon;
				},
				size: 14
			});
		};
		X(i, (e) => {
			t().icon && e(a);
		});
		var o = V(i);
		k(n), H(() => {
			r = Q(n, 1, "btn svelte-7gk24t", null, r, {
				primary: t().primary,
				danger: t().danger
			}), n.disabled = t().disabled, $(n, "title", t().title), Y(o, ` ${t().label ?? ""}`);
		}), K("click", n, () => void D(t())), J(e, n);
	}, r = (e, n, r = "info", i) => t.kandinsky.toast(e, n, r, { timeout: i }), i = (e) => t.kandinsky.richTitle(e), a = /* @__PURE__ */ I(R(dr(() => ta.get(t.source.id) ?? []))), o = /* @__PURE__ */ I(""), s = /* @__PURE__ */ I(R(dr(() => na.get(t.source.id)?.q ?? ""))), c = dr(() => na.get(t.source.id)), l = /* @__PURE__ */ I(R(c?.scope ?? { kind: "all" })), u = /* @__PURE__ */ I(R(c?.tab ?? null)), f = /* @__PURE__ */ I(!1), p = /* @__PURE__ */ I(R(dr(() => na.get(t.source.id)?.selId ?? null))), h = /* @__PURE__ */ I(R(dr(() => na.get(t.source.id)?.sortId ?? t.source.sorts[0]?.id ?? ""))), g = /* @__PURE__ */ I(null), _ = /* @__PURE__ */ I(""), v = /* @__PURE__ */ I(R(dr(() => na.get(t.source.id)?.layout ?? t.source.layouts[0]))), y = /* @__PURE__ */ I(R([])), b, x = [
		{
			id: "title",
			label: "Title"
		},
		{
			id: "author",
			label: "Creators"
		},
		{
			id: "year",
			label: "Year"
		},
		{
			id: "venue",
			label: "Publication"
		},
		{
			id: "kind",
			label: "Type"
		},
		{
			id: "added",
			label: "Added"
		},
		{
			id: "pdf",
			label: "PDF"
		}
	];
	async function S() {
		try {
			let e = new Map(G(a).map((e) => [e.id, e])), n = await t.source.load();
			L(a, (t.source.from ? n : n.filter((e) => !e.from)).map((t) => {
				let n = e.get(t.id);
				return n && JSON.stringify(n) === JSON.stringify(t) ? n : t;
			}), !0), ta.set(t.source.id, G(a)), L(o, "");
		} catch (e) {
			L(o, Zi(e), !0);
		}
	}
	let ee = /* @__PURE__ */ P(() => sa(G(a), (e) => e.groups, t.source.groupOrder)), te = /* @__PURE__ */ P(() => G(ee).some(([e]) => e.includes(ia))), ne = /* @__PURE__ */ I(R([])), re = /* @__PURE__ */ I(R([])), ie = /* @__PURE__ */ P(() => new Set([...G(ne), ...G(ee).map(([e]) => e.split(ia)[0])].filter((e) => !G(re).includes(e)))), ae = /* @__PURE__ */ P(() => G(te) ? oa(G(ee), G(ie)) : []);
	function oe(e) {
		G(ie).has(e) ? (L(ne, G(ne).filter((t) => t !== e), !0), L(re, [...G(re), e], !0)) : (L(re, G(re).filter((t) => t !== e), !0), L(ne, [...G(ne), e], !0));
	}
	let se = /* @__PURE__ */ P(() => sa(G(a), (e) => e.tags)), ce = /* @__PURE__ */ P(() => {
		let e = G(a);
		return (typeof t.source.tabs == "function" ? t.source.tabs() : t.source.tabs ?? []).map((t) => ({
			...t,
			n: e.filter((e) => e.tab === t.id).length
		})).filter((e) => e.n || e.always);
	}), le = (e, t) => G(l).kind === e && (e === "all" || G(l).name === t), ue = (e) => (!G(u) || e.tab === G(u)) && (G(l).kind === "all" || (G(l).kind === "group" ? aa(e.groups, G(l).name) : (e.tags ?? []).includes(G(l).name))), de = /* @__PURE__ */ P(() => G(a).filter((e) => ue(e) && ra(e, G(s)))), fe = /* @__PURE__ */ P(() => t.source.sorts.find((e) => e.id === G(h))), pe = /* @__PURE__ */ P(() => G(g) ?? !!G(fe)?.desc), me = (e) => e ? e.from ?? t.source.from ?? "" : "", C = /* @__PURE__ */ P(() => {
		let e = $i(G(de), {
			id: G(h),
			desc: G(pe)
		}), t = [...new Set(e.map(me).filter(Boolean))];
		return [...e.filter((e) => !me(e)), ...t.flatMap((t) => e.filter((e) => me(e) === t))];
	}), he = /* @__PURE__ */ P(() => G(a).filter((e) => !me(e)).length), ge = (e) => t.source.homes?.find((t) => t.from === e), w = /* @__PURE__ */ P(() => G(C).find((e) => e.id === G(p)) ?? G(C)[0] ?? null);
	function T(e) {
		let n;
		G(h) === e ? n = !G(pe) : (L(h, e, !0), n = t.source.sorts.find((t) => t.id === e)?.desc ?? (e === "year" || e === "added" || e === "pdf")), L(g, n, !0);
		let r = x.find((t) => t.id === e)?.label ?? e;
		L(_, `Sorted by ${r}, ${n ? "descending" : "ascending"}`);
	}
	let _e = /* @__PURE__ */ P(() => G(s) || G(l).kind !== "all" ? [] : ea(G(a).filter((e) => (!G(u) || e.tab === G(u)) && (!G(he) || !me(e))), 8));
	function ve(e) {
		t.source.open ? t.source.open(e) : (L(p, e.id, !0), L(A, [e.id], !0));
	}
	let ye = /* @__PURE__ */ I(1e3), be = /* @__PURE__ */ P(() => G(ye) < 700), xe = /* @__PURE__ */ P(() => G(be) ? G(p) !== null && G(w)?.id === G(p) ? G(w) : null : G(w)), E = /* @__PURE__ */ I(null);
	_n(() => {
		let e = G(w);
		if (!e) {
			L(E, null);
			return;
		}
		let n = dr(() => t.source.detail(e));
		if (!(n instanceof Promise)) {
			L(E, n, !0);
			return;
		}
		let r = !0;
		return n.then((e) => {
			r && L(E, e, !0);
		}, (e) => {
			r && L(o, Zi(e), !0);
		}), () => {
			r = !1;
		};
	});
	let Se = /* @__PURE__ */ I(null);
	async function D(e) {
		if ("edit" in e) {
			L(Se, {
				def: e.edit,
				values: Object.fromEntries(e.edit.fields.map((e) => [e.key, e.value]))
			}, !0);
			return;
		}
		"confirm" in e && !await t.kandinsky.confirm(e.confirm.title, {
			hint: e.confirm.hint,
			ok: e.confirm.button,
			danger: !0
		}) || await Ce(e.run);
	}
	async function Ce(e) {
		let t;
		try {
			t = await e();
		} catch (e) {
			r("It did not work", Zi(e), "error");
		}
		await S(), typeof t == "string" && t && (L(p, t, !0), L(A, [t], !0));
	}
	async function O() {
		if (G(Se)) try {
			await G(Se).def.save(G(Se).values), L(Se, null), await S();
		} catch (e) {
			r("Could not save", Zi(e), "error");
		}
	}
	let we = /* @__PURE__ */ P(() => G(w)?.id);
	_n(() => {
		G(we), L(Se, null);
	});
	let Te = /* @__PURE__ */ I(!1), De = /* @__PURE__ */ I("");
	async function Oe() {
		if (t.source.add && G(De).trim() && !G(Te)) {
			L(Te, !0);
			try {
				let e = await t.source.add.run(G(De).trim());
				await S(), e && L(p, e, !0), L(De, "");
			} catch (e) {
				r("Could not add it", Zi(e), "error", 9e3);
			} finally {
				L(Te, !1);
			}
		}
	}
	let ke = /* @__PURE__ */ I(!1);
	async function Ae(e) {
		if (e.preventDefault(), L(ke, !1), !t.source.drop) return;
		let n = [...e.dataTransfer?.files ?? []].filter((e) => t.source.drop.accept.test(e.name));
		if (!n.length) {
			r("Nothing here can take these files");
			return;
		}
		let i = await t.source.drop.run(n, G(l).kind === "group" ? G(l).name : void 0);
		await S(), i && (L(p, i, !0), L(A, [i], !0));
	}
	let je = "text/x-kandinsky-library", Me = /* @__PURE__ */ I(null);
	function Ne(e, t) {
		let n = G(A).length > 1 && G(Ie).has(t.id) ? G(A) : [t.id];
		e.dataTransfer?.setData(je, JSON.stringify(n)), e.dataTransfer && (e.dataTransfer.effectAllowed = "move");
	}
	let Pe = (e) => ({
		ondragover: (n) => {
			t.source.regroup && n.dataTransfer?.types.includes(je) && (n.preventDefault(), L(Me, e, !0));
		},
		ondragleave: () => {
			G(Me) === e && L(Me, null);
		},
		ondrop: async (n) => {
			let i = JSON.parse(n.dataTransfer?.getData(je) || "[]");
			if (t.source.regroup && i.length) {
				n.preventDefault(), n.stopPropagation(), L(Me, null);
				try {
					await t.source.regroup(G(a).filter((e) => i.includes(e.id)), e);
				} catch (e) {
					r("Not moved", Zi(e), "error");
				}
				await S();
			}
		}
	}), A = /* @__PURE__ */ I(R([])), Fe = null, Ie = /* @__PURE__ */ P(() => new Set(G(A))), Le = /* @__PURE__ */ P(() => G(C).filter((e) => G(Ie).has(e.id))), Re = (e) => G(A).length > 1 ? G(Ie).has(e.id) : G(xe)?.id === e.id;
	function ze(e, n) {
		if (G(be) && t.source.open && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.target.closest(".wrap")) {
			t.source.open(n);
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			let e = G(A).length ? G(A) : G(w) ? [G(w).id] : [];
			L(A, e.includes(n.id) ? e.filter((e) => e !== n.id) : [...e, n.id], !0);
		} else if (e.shiftKey && Fe) {
			let e = G(C).findIndex((e) => e.id === Fe), t = G(C).indexOf(n);
			L(A, e < 0 ? [n.id] : G(C).slice(Math.min(e, t), Math.max(e, t) + 1).map((e) => e.id), !0);
		} else L(A, [n.id], !0);
		e.shiftKey || (Fe = n.id), L(p, n.id, !0);
	}
	async function Be(e, n) {
		if (typeof t.kandinsky.shell.popMenu != "function") return;
		if (G(A).length > 1 && G(Ie).has(n.id)) {
			t.kandinsky.shell.popMenu(e, G(Ue).map((e) => ({
				label: e.label,
				icon: e.icon,
				danger: e.danger,
				disabled: e.disabled,
				run: () => D(e)
			})));
			return;
		}
		L(A, [n.id], !0), Fe = n.id, L(p, n.id, !0);
		let r = t.source.detail(n), i = r instanceof Promise ? null : r, a = [];
		if (t.source.open && !i?.actions.some((e) => e.primary) && a.push({
			label: "Open",
			icon: "book-open",
			run: () => t.source.open(n)
		}), i) {
			let e = (e) => ({
				label: "confirm" in e ? `${e.label.replace(/…$/, "")}…` : e.label,
				icon: e.icon,
				danger: e.danger,
				disabled: e.disabled,
				run: () => D(e)
			});
			if (a.push(...i.actions.filter((e) => !e.more && !e.danger).map(e)), i.choice) {
				a.push(null);
				for (let e of i.choice.options) a.push({
					label: `${e.on ? "✓ " : ""}${e.label}`,
					detail: i.choice.label,
					disabled: e.on,
					run: () => Ce(e.run)
				});
			}
			a.push(null, ...i.actions.filter((e) => e.more && !e.danger).map(e)), a.push(null, ...i.actions.filter((e) => e.danger).map(e));
		}
		t.kandinsky.shell.popMenu(e, a.map((e) => e && {
			...e,
			run: async () => {
				await e.run();
			}
		}), {
			path: n.note,
			openLabel: t.source.open ? "Open its note" : "Open"
		});
	}
	function Ve(e, n) {
		typeof t.kandinsky.shell.popMenu == "function" && t.kandinsky.shell.popMenu(e, n.map((e) => ({
			label: e.label,
			icon: e.icon,
			danger: e.danger,
			disabled: e.disabled,
			run: async () => {
				await D(e);
			}
		})));
	}
	let He = [];
	function j(e, t) {
		t ? He.length || (He = G(A)) : He = [], L(A, [.../* @__PURE__ */ new Set([...He, ...e])], !0), e.length && L(p, e.at(-1), !0);
	}
	let Ue = /* @__PURE__ */ P(() => {
		let e = G(Le);
		if (e.length < 2) return [];
		let n = t.source.open;
		return [...n ? [{
			label: `Open ${e.length}`,
			icon: "folder-open",
			primary: !0,
			run: () => {
				for (let t of e.slice(0, 20)) n(t);
			}
		}] : [], ...t.source.many?.(e) ?? []];
	});
	function Ke(e) {
		if (!G(C).length) return;
		let t = Math.max(0, Math.min(G(C).length - 1, (G(w) ? G(C).indexOf(G(w)) : -1) + e));
		L(p, G(C)[t].id, !0), L(A, [G(p)], !0), Fe = G(p);
		let n = !!b?.contains(document.activeElement);
		requestAnimationFrame(() => {
			let e = b?.querySelector(".row.sel, .card.sel, .trow.sel");
			e?.scrollIntoView({ block: "nearest" }), n && (e?.querySelector(".row-focus") ?? e)?.focus();
		});
	}
	function qe(e) {
		if (e.target.closest("input, select, textarea")) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
			e.preventDefault(), L(A, G(C).map((e) => e.id), !0);
			return;
		}
		if (e.key === "Escape" && G(A).length > 1) {
			e.preventDefault(), L(A, G(w) ? [G(w).id] : [], !0);
			return;
		}
		if (e.ctrlKey || ha(e) || e.altKey) return;
		let n = e.key;
		if (n === "ArrowDown" || n === "j" || G(v) === "covers" && n === "ArrowRight") Ke(1);
		else if (n === "ArrowUp" || n === "k" || G(v) === "covers" && n === "ArrowLeft") Ke(-1);
		else if (n === "Enter" && G(w) && t.source.open) t.source.open(G(w));
		else if (G(w) && t.source.keys?.[n]) t.source.keys[n](G(w));
		else return;
		e.preventDefault();
	}
	function Je(e, n) {
		return { destroy: t.kandinsky.mountBlock(e, {
			type: "backlinks",
			path: n,
			open: !0
		}) };
	}
	_n(() => {
		na.set(t.source.id, {
			scope: G(l),
			tab: G(u),
			q: G(s),
			selId: G(p),
			sortId: G(h),
			layout: G(v),
			scroll: dr(() => na.get(t.source.id)?.scroll ?? 0)
		});
	});
	let Ye = () => {
		let e = na.get(t.source.id);
		e && b && (e.scroll = b.scrollTop);
	};
	Ji(() => {
		let e = na.get(t.source.id)?.scroll ?? 0;
		e && b && requestAnimationFrame(() => {
			b.scrollTop = e;
		}), b?.addEventListener("scroll", Ye, { passive: !0 }), S(), t.source.tools?.().then((e) => L(y, e, !0), () => {});
		let n, r = t.source.watch?.(() => {
			clearTimeout(n), n = setTimeout(S, 1200);
		});
		return () => {
			r?.(), clearTimeout(n), b?.removeEventListener("scroll", Ye);
		};
	});
	var M = Yo();
	let Xe;
	var Ze = z(M), N = (e) => {
		var n = Ba(), r = B(n, !0);
		H(() => Y(r, t.source.drop.hint)), J(e, n);
	};
	X(Ze, (e) => {
		G(ke) && t.source.drop && e(N);
	});
	var Qe = V(Ze, 2), $e = z(Qe), et = z($e);
	Na(et, {
		get name() {
			return t.source.icon;
		},
		size: 18
	});
	var nt = V(et), rt = B(V(nt), !0);
	k($e);
	var it = V($e, 2);
	Mi(it);
	var at = V(it, 2), ot = (e) => {
		{
			let n = /* @__PURE__ */ P(() => t.source.sorts.map((e) => ({
				value: e.id,
				label: `Sort: ${e.label}`
			})));
			Ea(e, {
				get value() {
					return G(h);
				},
				label: "Sort by",
				onchange: (e) => {
					L(h, e, !0), L(g, null);
				},
				get options() {
					return G(n);
				}
			});
		}
	};
	X(at, (e) => {
		t.source.sorts.length > 1 && e(ot);
	});
	var st = V(at, 2), ct = (e) => {
		var n = Ha();
		Z(n, 20, () => t.source.layouts, (e) => e, (e, t) => {
			var n = Va();
			let r;
			var i = B(n, !0);
			H(() => {
				$(n, "aria-checked", G(v) === t), r = Q(n, 1, "svelte-7gk24t", null, r, { on: G(v) === t }), Y(i, t === "covers" ? "Covers" : t === "table" ? "Table" : "List");
			}), K("click", n, () => L(v, t, !0)), J(e, n);
		}), k(n), J(e, n);
	};
	X(st, (e) => {
		t.source.layouts.length > 1 && e(ct);
	});
	var lt = V(st, 2);
	Z(lt, 17, () => t.source.homes ?? [], (e) => e.from, (e, t) => {
		var n = Ua(), r = z(n);
		Na(r, {
			name: "server",
			size: 14
		});
		var i = V(r);
		Na(V(i), {
			name: "external-link",
			size: 12
		}), k(n), H(() => {
			$(n, "title", `Open ${G(t).from ?? ""} in its own tab: what is there, yours or not`), Y(i, ` ${G(t).label ?? ""} `);
		}), K("click", n, () => void Ce(G(t).run)), J(e, n);
	});
	var ut = V(lt, 2), dt = (e) => {
		var n = Wa(), r = z(n);
		Mi(r);
		var i = V(r, 2), a = B(i, !0);
		k(n), H((e) => {
			$(r, "placeholder", t.source.add.placeholder), r.disabled = G(Te), i.disabled = e, Y(a, G(Te) ? t.source.add.busy : "Add");
		}, [() => !G(De).trim() || G(Te)]), Er("submit", n, (e) => {
			e.preventDefault(), Oe();
		}), Ri(r, () => G(De), (e) => L(De, e)), J(e, n);
	};
	X(ut, (e) => {
		t.source.add && e(dt);
	}), Z(V(ut, 2), 17, () => G(y), (e) => e.label, (e, t) => {
		n(e, () => G(t));
	}), k(Qe);
	var ft = V(Qe, 2), pt = (e) => {
		var t = Ka(), n = z(t);
		let r;
		var i = B(V(z(n)), !0);
		k(n), Z(V(n, 2), 17, () => G(ce), (e) => e.id, (e, t) => {
			var n = Ga();
			let r;
			var i = z(n), a = B(V(i), !0);
			k(n), H(() => {
				r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: G(u) === G(t).id }), $(n, "aria-pressed", G(u) === G(t).id), Y(i, `${G(t).title ?? ""} `), Y(a, G(t).n);
			}), K("click", n, () => L(u, G(u) === G(t).id ? null : G(t).id, !0)), J(e, n);
		}), k(t), H(() => {
			r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: !G(u) }), Y(i, G(a).length);
		}), K("click", n, () => L(u, null)), J(e, t);
	};
	X(ft, (e) => {
		G(ce).length > 1 && e(pt);
	});
	var mt = V(ft, 2), ht = (e) => {
		var n = Ja(), r = z(n, !0), i = V(r), a = (e) => {
			var n = qa(), r = B(n, !0);
			H(() => Y(r, t.source.setup.label)), K("click", n, () => void Ce(async () => {
				await t.source.setup?.run(), await S();
			})), J(e, n);
		};
		X(i, (e) => {
			t.source.setup && e(a);
		}), k(n), H(() => Y(r, t.source.setup ? t.source.empty : G(o))), J(e, n);
	};
	X(mt, (e) => {
		G(o) && e(ht);
	});
	var gt = V(mt, 2), _t = (e) => {
		var n = Za(), r = V(z(n), 2);
		Z(r, 21, () => G(_e), (e) => e.id, (e, n) => {
			var r = Xa(), a = z(r);
			Ra(a, {
				get kandinsky() {
					return t.kandinsky;
				},
				get cover() {
					return G(n).cover;
				},
				get title() {
					return G(n).title;
				}
			});
			var o = V(a, 2);
			ri(o, () => i(G(n).title), !0), k(o);
			var s = V(o, 2), c = (e) => {
				var t = Ya();
				let r;
				H((e) => {
					$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": G(n).progress });
				}, [() => Math.round(G(n).progress * 100)]), J(e, t);
			};
			X(s, (e) => {
				G(n).progress && e(c);
			}), k(r), H(() => $(r, "title", t.source.open ? `Open ${G(n).title}` : G(n).title)), K("click", r, () => ve(G(n))), J(e, r);
		}), k(r), k(n), J(e, n);
	};
	X(gt, (e) => {
		G(_e).length && e(_t);
	});
	var vt = V(gt, 2);
	let yt;
	var F = z(vt), bt = (e) => {
		var n = ao(), r = z(n);
		let i;
		var o = z(r);
		Na(o, {
			get name() {
				return t.source.icon;
			},
			size: 14
		});
		var s = V(o), c = B(s), u = B(V(s), !0);
		k(r);
		var d = V(r, 2), p = (e) => {
			var n = no(), r = an(n), i = B(r, !0), a = V(r, 2), o = (e) => {
				var t = Fr();
				Z(an(t), 17, () => G(ae), (e) => e.path, (e, t) => {
					var n = eo();
					let r;
					var i = z(n), a = (e) => {
						var n = Qa(), r = z(n);
						{
							let e = /* @__PURE__ */ P(() => G(ie).has(G(t).path) ? "chevron-down" : "chevron");
							Na(r, {
								get name() {
									return G(e);
								},
								size: 12
							});
						}
						k(n), H((e, t) => {
							$(n, "aria-label", e), $(n, "aria-expanded", t);
						}, [() => G(ie).has(G(t).path) ? `Close ${G(t).name}` : `Open ${G(t).name}`, () => G(ie).has(G(t).path)]), K("click", n, () => oe(G(t).path)), J(e, n);
					}, o = (e) => {
						J(e, $a());
					};
					X(i, (e) => {
						G(t).kids ? e(a) : e(o, -1);
					});
					var s = V(i, 2), c = () => L(l, {
						kind: "group",
						name: G(t).path
					}, !0), u = () => G(t).kids && oe(G(t).path);
					Pi(s, (e, n) => ({
						class: "item",
						onclick: c,
						ondblclick: u,
						title: G(t).path,
						...e,
						[wi]: {
							on: n,
							drop: G(Me) === G(t).path
						}
					}), [() => Pe(G(t).path), () => le("group", G(t).path)], void 0, void 0, "svelte-7gk24t");
					var d = z(s);
					{
						let e = /* @__PURE__ */ P(() => G(ie).has(G(t).path) && G(t).kids ? "folder-open" : "folder");
						Na(d, {
							get name() {
								return G(e);
							},
							size: 14
						});
					}
					var f = V(d), p = B(f, !0), m = B(V(f), !0);
					k(s), k(n), H(() => {
						r = gi(n, "", r, { "padding-left": `${G(t).depth * 12}px` }), Y(p, G(t).name), Y(m, G(t).count);
					}), J(e, n);
				}), J(e, t);
			}, s = (e) => {
				var t = Fr();
				Z(an(t), 17, () => G(ee), ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ P(() => m(G(t), 2));
					let r = () => G(n)[0], i = () => G(n)[1];
					var a = to(), o = () => L(l, {
						kind: "group",
						name: r()
					}, !0);
					Pi(a, (e, t) => ({
						class: "item",
						onclick: o,
						title: r(),
						...e,
						[wi]: {
							on: t,
							drop: G(Me) === r()
						}
					}), [() => Pe(r()), () => le("group", r())], void 0, void 0, "svelte-7gk24t");
					var s = z(a);
					Na(s, {
						name: "folder",
						size: 14
					});
					var c = V(s), u = B(c, !0), d = B(V(c), !0);
					k(a), H(() => {
						Y(u, r()), Y(d, i());
					}), J(e, a);
				}), J(e, t);
			};
			X(a, (e) => {
				G(te) ? e(o) : e(s, -1);
			}), H(() => Y(i, t.source.groupsTitle ?? "Groups")), J(e, n);
		};
		X(d, (e) => {
			G(ee).length && e(p);
		});
		var h = V(d, 2), g = (e) => {
			var t = io(), n = an(t), r = z(n);
			{
				let e = /* @__PURE__ */ P(() => G(f) ? "chevron-down" : "chevron");
				Na(r, {
					get name() {
						return G(e);
					},
					size: 12
				});
			}
			var i = B(V(r, 2), !0);
			k(n);
			var a = V(n, 2), o = (e) => {
				var t = Fr();
				Z(an(t), 17, () => G(se), ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ P(() => m(G(t), 2));
					let r = () => G(n)[0], i = () => G(n)[1];
					var a = Fr(), o = an(a), s = (e) => {
						var t = ro();
						let n;
						var a = V(z(t)), o = B(a, !0), s = B(V(a), !0);
						k(t), H((e) => {
							n = Q(t, 1, "item tagitem svelte-7gk24t", null, n, { on: e }), $(t, "title", r()), Y(o, r()), Y(s, i());
						}, [() => le("tag", r())]), K("click", t, () => L(l, {
							kind: "tag",
							name: r()
						}, !0)), J(e, t);
					}, c = /* @__PURE__ */ P(() => G(f) || le("tag", r()));
					X(o, (e) => {
						G(c) && e(s);
					}), J(e, a);
				}), J(e, t);
			};
			X(a, (e) => {
				(G(f) || G(l).kind === "tag") && e(o);
			}), H(() => {
				$(n, "aria-expanded", G(f)), Y(i, G(se).length);
			}), K("click", n, () => L(f, !G(f))), J(e, t);
		};
		X(h, (e) => {
			G(se).length && e(g);
		}), k(n), H((e) => {
			$(n, "aria-label", t.source.groupsTitle ?? "Groups"), i = Q(r, 1, "item svelte-7gk24t", null, i, { on: e }), Y(c, `All ${t.source.noun ?? ""}`), Y(u, G(a).length);
		}, [() => le("all")]), K("click", r, () => L(l, { kind: "all" }, !0)), J(e, n);
	};
	X(F, (e) => {
		(G(ee).length || G(se).length) && e(bt);
	});
	var xt = V(F, 2);
	let St;
	var Ct = z(xt), wt = (e) => {
		var n = lo(), r = an(n), a = B(r, !0), o = V(r, 2), s = z(o), c = B(s, !0), l = V(s), u = z(l);
		Z(u, 21, () => x, (e) => e.id, (e, t) => {
			var n = oo(), r = z(n), i = z(r), a = B(i, !0), o = B(V(i), !0);
			k(r), k(n), H(() => {
				Q(n, 1, `col-${G(t).id ?? ""}`, "svelte-7gk24t"), $(n, "aria-sort", G(h) === G(t).id ? G(pe) ? "descending" : "ascending" : void 0), Y(a, G(t).label), Y(o, G(h) === G(t).id ? G(pe) ? " ↓" : " ↑" : "");
			}), K("click", r, () => T(G(t).id)), J(e, n);
		}), k(u), k(l);
		var d = V(l);
		Z(d, 21, () => G(C), (e) => e.id, (e, n) => {
			var r = co();
			let a;
			var o = z(r), s = z(o), c = z(s);
			ri(c, () => i(G(n).title), !0), k(c), k(s), k(o);
			var l = V(o), u = B(l, !0), d = V(l), f = B(d, !0), p = V(d), m = B(p, !0), h = V(p), g = B(h, !0), _ = V(h), v = B(_, !0), y = V(_), b = z(y), x = (e) => {
				J(e, so());
			}, S = /* @__PURE__ */ P(() => G(n).columns?.hasPdf ?? G(n).flags?.some((e) => e.label === "PDF"));
			X(b, (e) => {
				G(S) && e(x);
			}), k(y), k(r), H((e) => {
				a = Q(r, 1, "trow svelte-7gk24t", null, a, { sel: e }), $(r, "data-pick", G(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0), $(o, "title", G(n).title), $(l, "title", G(n).columns?.creators ?? G(n).sub ?? ""), Y(u, G(n).columns?.creators ?? G(n).sub ?? ""), Y(f, G(n).columns?.year ?? ""), $(p, "title", G(n).columns?.venue ?? ""), Y(m, G(n).columns?.venue ?? ""), Y(g, G(n).columns?.kind ?? ""), Y(v, G(n).columns?.added ?? "");
			}, [() => Re(G(n))]), Er("dragstart", r, (e) => Ne(e, G(n))), K("click", r, (e) => ze(e, G(n))), K("dblclick", r, () => t.source.open?.(G(n))), K("contextmenu", r, (e) => void Be(e, G(n))), K("click", s, (e) => {
				e.stopPropagation(), ze(e, G(n));
			}), K("dblclick", s, (e) => {
				e.stopPropagation(), t.source.open?.(G(n));
			}), J(e, r);
		}), k(d), k(o), H(() => {
			Y(a, G(_)), Y(c, t.source.title);
		}), J(e, n);
	}, Tt = (e) => {
		var n = Fr();
		Z(an(n), 19, () => G(C), (e) => e.id, (e, n, r) => {
			var a = vo(), o = an(a), s = (e) => {
				let t = /* @__PURE__ */ P(() => ge(me(G(n))));
				var r = fo(), i = z(r);
				Na(i, {
					name: "server",
					size: 14
				});
				var a = V(i), o = B(a), s = V(a, 2), c = B(s, !0), l = V(s, 2), u = (e) => {
					var n = uo(), r = z(n);
					Na(V(r), {
						name: "external-link",
						size: 12
					}), k(n), H(() => Y(r, `${G(t).label ?? ""} `)), K("click", n, () => void Ce(G(t).run)), J(e, n);
				};
				X(l, (e) => {
					G(t) && e(u);
				}), k(r), H((e, t) => {
					Y(o, `From ${e ?? ""}`), Y(c, t);
				}, [() => me(G(n)), () => G(C).filter((e) => me(e) === me(G(n))).length]), J(e, r);
			}, c = /* @__PURE__ */ P(() => me(G(n)) && me(G(n)) !== me(G(C)[G(r) - 1]));
			X(o, (e) => {
				G(c) && e(s);
			});
			var l = V(o, 2), u = (e) => {
				var r = mo();
				let a;
				var o = z(r);
				Ra(o, {
					get kandinsky() {
						return t.kandinsky;
					},
					get cover() {
						return G(n).cover;
					},
					get title() {
						return G(n).title;
					}
				});
				var s = V(o, 2), c = (e) => {
					var t = Ya();
					let r;
					H((e) => {
						$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": G(n).progress });
					}, [() => Math.round(G(n).progress * 100)]), J(e, t);
				};
				X(s, (e) => {
					G(n).progress && e(c);
				});
				var l = V(s, 2);
				ri(l, () => i(G(n).title), !0), k(l);
				var u = V(l, 2), d = (e) => {
					var t = po(), r = B(t, !0);
					H(() => Y(r, G(n).sub)), J(e, t);
				};
				X(u, (e) => {
					G(n).sub && e(d);
				}), k(r), H((e) => {
					a = Q(r, 1, "card svelte-7gk24t", null, a, { sel: e }), $(r, "data-pick", G(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0), $(r, "title", G(n).sub);
				}, [() => Re(G(n))]), Er("dragstart", r, (e) => Ne(e, G(n))), K("click", r, (e) => ze(e, G(n))), K("dblclick", r, () => t.source.open?.(G(n))), K("contextmenu", r, (e) => void Be(e, G(n))), J(e, r);
			}, d = (e) => {
				var r = _o();
				let a;
				var o = z(r);
				ri(o, () => i(G(n).title), !0), k(o);
				var s = V(o, 2), c = (e) => {
					var t = po(), r = B(t, !0);
					H(() => Y(r, G(n).sub)), J(e, t);
				};
				X(s, (e) => {
					G(n).sub && e(c);
				});
				var l = V(s, 2), u = (e) => {
					var t = go();
					Z(t, 21, () => G(n).flags, (e) => e.label, (e, t) => {
						var n = ho();
						let r;
						var i = B(n, !0);
						H(() => {
							r = Q(n, 1, "flag svelte-7gk24t", null, r, { red: G(t).tone === "red" }), Y(i, G(t).label);
						}), J(e, n);
					}), k(t), J(e, t);
				};
				X(l, (e) => {
					G(n).flags?.length && e(u);
				});
				var d = V(l, 2), f = (e) => {
					var t = Ya();
					let r;
					H((e) => {
						$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": G(n).progress });
					}, [() => Math.round(G(n).progress * 100)]), J(e, t);
				};
				X(d, (e) => {
					G(n).progress && e(f);
				}), k(r), H((e) => {
					a = Q(r, 1, "row svelte-7gk24t", null, a, { sel: e }), $(r, "data-pick", G(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0);
				}, [() => Re(G(n))]), Er("dragstart", r, (e) => Ne(e, G(n))), K("click", r, (e) => ze(e, G(n))), K("dblclick", r, () => t.source.open?.(G(n))), K("contextmenu", r, (e) => void Be(e, G(n))), J(e, r);
			};
			X(l, (e) => {
				G(v) === "covers" ? e(u) : e(d, -1);
			}), Ee(), J(e, a);
		}, (e) => {
			var n = yo(), r = z(n, !0), i = V(r), o = (e) => {
				var n = qa(), r = B(n, !0);
				H(() => Y(r, t.source.setup.label)), K("click", n, () => void Ce(async () => {
					await t.source.setup?.run(), await S();
				})), J(e, n);
			};
			X(i, (e) => {
				!G(a).length && t.source.setup && e(o);
			}), k(n), H((e) => Y(r, e), [() => G(a).length ? "Nothing matches." : t.source.homes?.length ? `Nothing of yours yet. What is on ${t.source.homes.map((e) => e.from).join(" or ")} is in its own tab (the button above); a thing comes here once you read it or write about it.` : t.source.empty]), J(e, n);
		}), J(e, n);
	};
	X(Ct, (e) => {
		G(v) === "table" && G(C).length ? e(wt) : e(Tt, -1);
	}), k(xt), Wi(xt, (e) => b = e, () => b), ai(xt, (e, t) => _a?.(e, t), () => ({ pick: j }));
	var Et = V(xt, 2), Dt = (e) => {
		var r = So(), a = z(r), o = B(a), s = V(a, 2), c = z(s);
		Z(c, 17, () => G(Le).slice(0, 12), (e) => e.id, (e, t) => {
			var n = bo();
			ri(n, () => i(G(t).title), !0), k(n), J(e, n);
		});
		var l = V(c), u = (e) => {
			var t = xo(), n = B(t);
			H(() => Y(n, `and ${G(Le).length - 12} more`)), J(e, t);
		};
		X(l, (e) => {
			G(Le).length > 12 && e(u);
		}), k(s);
		var d = V(s, 2), f = z(d);
		Z(f, 17, () => G(Ue), (e) => e.label, (e, t) => {
			n(e, () => G(t));
		});
		var p = V(f);
		k(d), k(r), H(() => Y(o, `${G(Le).length ?? ""} ${t.source.noun ?? ""} picked`)), K("click", p, () => L(A, G(w) ? [G(w).id] : [], !0)), J(e, r);
	}, Ot = (e) => {
		var r = qo(), a = an(r), o = (e) => {
			var t = Co();
			K("click", t, () => L(p, null)), J(e, t);
		};
		X(a, (e) => {
			G(be) && e(o);
		});
		var s = V(a, 2), c = z(s), u = (e) => {
			var t = wo();
			Na(z(t), {
				name: "close",
				size: 16
			}), k(t), K("click", t, () => L(p, null)), J(e, t);
		};
		X(c, (e) => {
			G(be) && e(u);
		});
		var d = V(c, 2), f = (e) => {
			var t = ko(), n = z(t);
			Z(n, 17, () => G(Se).def.fields, (e) => e.key, (e, t) => {
				var n = Oo();
				let r;
				var i = z(n, !0), a = V(i), o = (e) => {
					var n = To(), r = B(n, !0);
					H(() => Y(r, G(t).hint)), J(e, n);
				};
				X(a, (e) => {
					G(t).hint && e(o);
				});
				var s = V(a, 2), c = (e) => {
					var n = Eo();
					tt(n), H(() => $(n, "rows", G(t).rows)), Ri(n, () => G(Se).values[G(t).key], (e) => G(Se).values[G(t).key] = e), J(e, n);
				}, l = (e) => {
					var n = Do();
					Mi(n), Ri(n, () => G(Se).values[G(t).key], (e) => G(Se).values[G(t).key] = e), J(e, n);
				};
				X(s, (e) => {
					G(t).rows ? e(c) : e(l, -1);
				}), k(n), H(() => {
					r = Q(n, 1, "svelte-7gk24t", null, r, { half: G(t).half }), Y(i, G(t).label);
				}), J(e, n);
			});
			var r = V(n, 2), i = V(z(r));
			k(r), k(t), Er("submit", t, (e) => {
				e.preventDefault(), O();
			}), K("keydown", t, (e) => {
				e.key === "Escape" && (e.stopPropagation(), L(Se, null));
			}), K("click", i, () => L(Se, null)), J(e, t);
		};
		X(d, (e) => {
			G(Se) && e(f);
		});
		var h = V(d, 2), g = (e) => {
			var t = Ao(), n = B(t, !0);
			H(() => Y(n, G(E).kind)), J(e, t);
		};
		X(h, (e) => {
			G(E).kind && e(g);
		});
		var _ = V(h, 2);
		ri(_, () => i(G(E).title), !0), k(_);
		var v = V(_, 2);
		Z(v, 17, () => G(E).lines ?? [], Jr, (e, t) => {
			var n = jo(), r = B(n, !0);
			H(() => {
				Q(n, 1, li(G(t).muted ? "venue" : "authors"), "svelte-7gk24t"), Y(r, G(t).text);
			}), J(e, n);
		});
		var y = V(v, 2), b = z(y);
		Z(b, 17, () => G(E).actions.filter((e) => !e.more), (e) => e.label, (e, t) => {
			n(e, () => G(t));
		});
		var x = V(b, 2), S = (e) => {
			let t = /* @__PURE__ */ P(() => G(E).actions.filter((e) => e.more));
			var n = Mo();
			Na(z(n), {
				name: "more",
				size: 14
			}), k(n), H((e) => $(n, "title", `More: ${e ?? ""}`), [() => G(t).map((e) => e.label).join(", ")]), K("click", n, (e) => Ve(e, G(t))), J(e, n);
		}, ee = /* @__PURE__ */ P(() => G(E).actions.some((e) => e.more));
		X(x, (e) => {
			G(ee) && e(S);
		}), k(y);
		var te = V(y, 2), ne = (e) => {
			var n = Io();
			let r;
			var i = z(n), a = (e) => {
				var n = No();
				qr(z(n), () => G(w).id, (e) => {
					Ra(e, {
						get kandinsky() {
							return t.kandinsky;
						},
						get cover() {
							return G(w).cover;
						},
						get title() {
							return G(w).title;
						},
						big: !0
					});
				}), k(n), J(e, n);
			};
			X(i, (e) => {
				G(w).cover && e(a);
			});
			var o = V(i, 2), s = (e) => {
				var t = Fo();
				Z(t, 21, () => G(E).fields, ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ P(() => m(G(t), 2));
					let r = () => G(n)[0], i = () => G(n)[1];
					var a = Po(), o = an(a), s = B(o, !0), c = B(V(o), !0);
					H(() => {
						Y(s, r()), Y(c, i());
					}), J(e, a);
				}), k(t), J(e, t);
			};
			X(o, (e) => {
				G(E).fields?.length && e(s);
			}), k(n), H(() => r = Q(n, 1, "facts svelte-7gk24t", null, r, { pic: !!G(w).cover })), J(e, n);
		};
		X(te, (e) => {
			(G(w).cover || G(E).fields?.length) && e(ne);
		});
		var re = V(te, 2), ie = (e) => {
			var t = Lo(), n = z(t), r = B(n, !0);
			Z(V(n, 2), 17, () => G(E).choice.options, (e) => e.label, (e, t) => {
				var n = Va();
				let r;
				var i = B(n, !0);
				H(() => {
					r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: G(t).on }), $(n, "aria-checked", G(t).on), Y(i, G(t).label);
				}), K("click", n, () => void Ce(G(t).run)), J(e, n);
			}), k(t), H(() => {
				$(t, "aria-label", G(E).choice.label), Y(r, G(E).choice.label);
			}), J(e, t);
		};
		X(re, (e) => {
			G(E).choice && e(ie);
		});
		var ae = V(re, 2), oe = (e) => {
			var t = zo();
			Z(t, 21, () => G(E).links, (e) => e.url, (e, t) => {
				var n = Ro(), r = z(n);
				Na(r, {
					name: "link",
					size: 13
				});
				var i = V(r);
				k(n), H(() => {
					$(n, "href", G(t).url), Y(i, ` ${G(t).label ?? ""}`);
				}), J(e, n);
			}), k(t), J(e, t);
		};
		X(ae, (e) => {
			G(E).links?.length && e(oe);
		});
		var se = V(ae, 2), ce = (e) => {
			var t = Ho(), n = z(t);
			Z(n, 16, () => G(w).groups ?? [], (e) => e, (e, t) => {
				var n = Bo(), r = z(n);
				Na(r, {
					name: "folder",
					size: 12
				});
				var i = V(r, 1, !0);
				k(n), H(() => Y(i, t)), K("click", n, () => L(l, {
					kind: "group",
					name: t
				}, !0)), J(e, n);
			}), Z(V(n, 2), 16, () => G(w).tags ?? [], (e) => e, (e, t) => {
				var n = Vo(), r = B(n);
				H(() => Y(r, `#${t ?? ""}`)), K("click", n, () => L(l, {
					kind: "tag",
					name: t
				}, !0)), J(e, n);
			}), k(t), J(e, t);
		};
		X(se, (e) => {
			(G(w).groups?.length || G(w).tags?.length) && e(ce);
		});
		var le = V(se, 2), ue = (e) => {
			var t = Uo(), n = an(t), r = B(n, !0), i = B(V(n), !0);
			H(() => {
				Y(r, G(E).body.title), Y(i, G(E).body.text);
			}), J(e, t);
		};
		X(le, (e) => {
			G(E).body && e(ue);
		});
		var de = V(le, 2), fe = (e) => {
			var t = Wo(), n = V(an(t)), r = B(n, !0), i = V(n);
			H(() => Y(r, G(E).notes.text)), K("click", i, () => G(E)?.notes?.open()), J(e, t);
		};
		X(de, (e) => {
			G(E).notes && e(fe);
		});
		var pe = V(de, 2), me = (e) => {
			var t = Ko();
			qr(z(t), () => G(w).note, (e) => {
				var t = Go();
				ai(t, (e, t) => Je?.(e, t), () => G(w).note), J(e, t);
			}), k(t), J(e, t);
		};
		X(pe, (e) => {
			G(w).note && e(me);
		}), k(s), J(e, r);
	}, kt = (e) => {
		var n = Jo(), r = z(n), i = z(r);
		Ee(), k(r), k(n), H(() => Y(i, `Pick one of the ${t.source.noun ?? ""} to see it here.`)), J(e, n);
	};
	X(Et, (e) => {
		G(Le).length > 1 ? e(Dt) : G(xe) && G(E) ? e(Ot, 1) : !G(be) && G(a).length && e(kt, 2);
	}), k(vt), k(M), H(() => {
		Xe = Q(M, 1, "library svelte-7gk24t", null, Xe, {
			dragging: G(ke),
			narrow: G(be)
		}), $(M, "aria-label", t.source.title), $(M, "data-source", t.source.id), Y(nt, ` ${t.source.title ?? ""} `), Y(rt, G(de).length === G(a).length ? G(a).length : `${G(de).length} / ${G(a).length}`), $(it, "placeholder", t.source.search), yt = Q(vt, 1, "body svelte-7gk24t", null, yt, { bare: !G(ee).length && !G(se).length }), St = Q(xt, 1, "list svelte-7gk24t", null, St, {
			covers: G(v) === "covers",
			"table-mode": G(v) === "table",
			"empty-list": !G(a).length
		});
	}), K("keydown", M, qe), Er("dragover", M, (e) => {
		t.source.drop && e.dataTransfer?.types.includes("Files") && (e.preventDefault(), L(ke, !0));
	}), Er("dragleave", M, (e) => {
		e.currentTarget === e.target && L(ke, !1);
	}), Er("drop", M, Ae), Ri(it, () => G(s), (e) => L(s, e)), Hi(M, "clientWidth", (e) => L(ye, e)), J(e, M), Ge();
}
Dr([
	"click",
	"keydown",
	"dblclick",
	"contextmenu"
]);
//#endregion
//#region plugins/beta/catalog/ui/src/Libraries.svelte
var Qo = /* @__PURE__ */ q("<button role=\"tab\"><!> </button>"), $o = /* @__PURE__ */ q("<span class=\"apart svelte-1hozhyt\" aria-hidden=\"true\"></span><span class=\"label svelte-1hozhyt\">On your servers</span> <!>", 1), es = /* @__PURE__ */ q("<div class=\"which svelte-1hozhyt\" role=\"tablist\" aria-label=\"Libraries\"><!> <!></div>"), ts = /* @__PURE__ */ q("<p class=\"none svelte-1hozhyt\">No library in this vault yet. Show a folder as a library from its menu in the file explorer (“Show as a library”), or add one in Settings → Libraries.</p>"), ns = /* @__PURE__ */ q("<p class=\"none svelte-1hozhyt\"> </p>"), rs = /* @__PURE__ */ q("<div class=\"libraries svelte-1hozhyt\"><!> <!></div>"), is = {
	hash: "svelte-1hozhyt",
	code: ".libraries.svelte-1hozhyt {display:flex;flex-direction:column;height:100%;min-height:0;}.which.svelte-1hozhyt {display:flex;gap:4px;padding:6px 10px 0;overflow-x:auto;flex:none;border-bottom:1px solid var(--border);}.which.svelte-1hozhyt button:where(.svelte-1hozhyt) {display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:none;background:none;color:var(--text-muted);border-bottom:2px solid transparent;white-space:nowrap;font:inherit;cursor:pointer;}.which.svelte-1hozhyt button:where(.svelte-1hozhyt):hover {color:var(--text);}.which.svelte-1hozhyt button.on:where(.svelte-1hozhyt) {color:var(--text);border-bottom-color:var(--accent);}.which.svelte-1hozhyt .apart:where(.svelte-1hozhyt) {flex:none;width:1px;margin:6px 6px 8px;background:var(--border-strong);}.which.svelte-1hozhyt .label:where(.svelte-1hozhyt) {flex:none;align-self:center;padding:0 4px 2px;color:var(--text-faint);font-size:calc(11px * var(--ui-scale, 1));text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}.libraries.svelte-1hozhyt > :last-child {flex:1;min-height:0;}.none.svelte-1hozhyt {padding:24px;color:var(--text-muted);}"
};
function as(e, t) {
	We(t, !0), ii(e, is);
	let n = "kandinsky.libraries.last", r = /* @__PURE__ */ I(dr(() => t.kandinsky.libraries.list())), i = /* @__PURE__ */ P(() => fa(G(r))), a = /* @__PURE__ */ P(() => G(i).filter((e) => !e.from)), o = /* @__PURE__ */ P(() => G(i).filter((e) => e.from)), s = /* @__PURE__ */ I(R(dr(() => t.kandinsky.anchor) || Yi(n, "")));
	Ji(() => {
		let e = t.kandinsky.libraries.onChange((e) => L(r, e)), n = t.kandinsky.pane?.onAnchor((e) => L(s, e, !0));
		return () => {
			e(), n?.();
		};
	});
	let c = /* @__PURE__ */ P(() => G(i).find((e) => e.id === G(s) || e.members?.includes(G(s))) ?? G(i)[0]), l = /* @__PURE__ */ I(null), u = /* @__PURE__ */ I("");
	_n(() => {
		let e = G(c);
		if (L(l, null), L(u, ""), !e) return;
		Xi(n, e.id);
		let t = !0;
		return Promise.resolve(e.source()).then((e) => {
			t && L(l, e, !0);
		}, (n) => {
			t && L(u, `${e.title}: ${Zi(n)}`);
		}), () => {
			t = !1;
		};
	});
	var f = rs();
	{
		let e = (e, t = d) => {
			var n = Qo();
			let r;
			var i = z(n);
			Na(i, {
				get name() {
					return t().icon;
				},
				size: 14
			});
			var a = V(i, 1, !0);
			k(n), H(() => {
				$(n, "aria-selected", t() === G(c)), r = Q(n, 1, "svelte-1hozhyt", null, r, { on: t() === G(c) }), Y(a, t().title);
			}), K("click", n, () => L(s, t().id, !0)), J(e, n);
		};
		var p = z(f), m = (t) => {
			var n = es(), r = z(n);
			Z(r, 17, () => G(a), (e) => e.id, (t, n) => {
				e(t, () => G(n));
			});
			var i = V(r, 2), s = (t) => {
				var n = $o();
				Z(V(an(n), 3), 17, () => G(o), (e) => e.id, (t, n) => {
					e(t, () => G(n));
				}), J(t, n);
			};
			X(i, (e) => {
				G(o).length && e(s);
			}), k(n), J(t, n);
		};
		X(p, (e) => {
			G(i).length > 1 && e(m);
		});
		var h = V(p, 2), g = (e) => {
			J(e, ts());
		}, _ = (e) => {
			var t = ns(), n = B(t, !0);
			H(() => Y(n, G(u))), J(e, t);
		}, v = (e) => {
			var n = Fr();
			qr(an(n), () => G(l), (e) => {
				Zo(e, {
					get kandinsky() {
						return t.kandinsky;
					},
					get source() {
						return G(l);
					}
				});
			}), J(e, n);
		};
		X(h, (e) => {
			G(c) ? G(u) ? e(_, 1) : G(l) && e(v, 2) : e(g);
		}), k(f);
	}
	J(e, f), Ge();
}
Dr(["click"]);
//#endregion
//#region plugins/beta/catalog/ui/src/view.ts
function os(e, t) {
	e.style.height = "100%";
	let n = Br(as, {
		target: e,
		props: { kandinsky: t }
	});
	return () => void Wr(n);
}
function ss(e, t, n) {
	e.style.height = "100%";
	let r = Br(Zo, {
		target: e,
		props: {
			kandinsky: n,
			source: t
		}
	});
	return () => void Wr(r);
}
//#endregion
export { os as default, ss as mountLibrary };
