//#region ui/node_modules/svelte/src/internal/shared/utils.js
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
//#region ui/node_modules/svelte/src/internal/client/constants.js
var h = 1 << 24, g = 1024, _ = 2048, v = 4096, y = 8192, ee = 16384, b = 32768, te = 1 << 25, ne = 65536, re = 1 << 19, ie = 1 << 20, ae = 1 << 25, oe = 1 << 21, se = 1 << 22, ce = 1 << 23, x = Symbol("$state"), le = Symbol("component"), ue = Symbol("legacy props"), de = Symbol(""), fe = Symbol("attributes"), pe = Symbol("class"), me = Symbol("style"), he = Symbol("text"), ge = Symbol("form reset"), _e = new class extends Error {
	name = "StaleReactionError";
	message = "The reaction that called `getAbortSignal()` was re-run or destroyed";
}(), ve = !!globalThis.document?.contentType && /* @__PURE__ */ globalThis.document.contentType.includes("xml"), S = {}, C = Symbol("uninitialized"), ye = "http://www.w3.org/1999/xhtml", be = "http://www.w3.org/2000/svg", w = "http://www.w3.org/1998/Math/MathML";
function xe() {
	console.warn("https://svelte.dev/e/derived_inert");
}
function Se(e) {
	console.warn("https://svelte.dev/e/hydration_mismatch");
}
function Ce() {
	console.warn("https://svelte.dev/e/select_multiple_invalid_value");
}
function we() {
	console.warn("https://svelte.dev/e/svelte_boundary_reset_noop");
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/hydration.js
var T = !1;
function Te(e) {
	T = e;
}
var E;
function D(e) {
	if (e === null) throw Se(), S;
	return E = e;
}
function Ee() {
	return D(/* @__PURE__ */ on(E));
}
function O(e) {
	if (T) {
		if (/* @__PURE__ */ on(E) !== null) throw Se(), S;
		E = e;
	}
}
function De(e = 1) {
	if (T) {
		for (var t = e, n = E; t--;) n = /* @__PURE__ */ on(n);
		E = n;
	}
}
function Oe(e = !0) {
	for (var t = 0, n = E;;) {
		if (n.nodeType === 8) {
			var r = n.data;
			if (r === "]") {
				if (t === 0) return n;
				--t;
			} else (r === "[" || r === "[!" || r[0] === "[" && !isNaN(Number(r.slice(1)))) && (t += 1);
		}
		var i = /* @__PURE__ */ on(n);
		e && n.remove(), n = i;
	}
}
function ke(e) {
	if (!e || e.nodeType !== 8) throw Se(), S;
	return e.data;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/equality.js
function Ae(e) {
	return e === this.v;
}
function je(e, t) {
	return e == e ? e !== t || typeof e == "object" && !!e || typeof e == "function" : t == t;
}
function Me(e) {
	return !je(e, this.v);
}
function Ne(e) {
	throw Error("https://svelte.dev/e/lifecycle_outside_component");
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/errors.js
function Pe() {
	throw Error("https://svelte.dev/e/async_derived_orphan");
}
function Fe(e, t, n) {
	throw Error("https://svelte.dev/e/each_key_duplicate");
}
function Ie(e) {
	throw Error("https://svelte.dev/e/effect_in_teardown");
}
function Le() {
	throw Error("https://svelte.dev/e/effect_in_unowned_derived");
}
function Re(e) {
	throw Error("https://svelte.dev/e/effect_orphan");
}
function ze() {
	throw Error("https://svelte.dev/e/effect_update_depth_exceeded");
}
function k(e) {
	throw Error("https://svelte.dev/e/props_invalid_value");
}
function Be() {
	throw Error("https://svelte.dev/e/state_descriptors_fixed");
}
function Ve() {
	throw Error("https://svelte.dev/e/state_prototype_fixed");
}
function He() {
	throw Error("https://svelte.dev/e/state_unsafe_mutation");
}
function Ue() {
	throw Error("https://svelte.dev/e/svelte_boundary_reset_onerror");
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/context.js
var A = null;
function We(e) {
	A = e;
}
function Ge(e, t = !1, n) {
	A = {
		p: A,
		i: !1,
		c: null,
		e: null,
		s: e,
		x: null,
		r: U,
		l: null
	};
}
function Ke(e) {
	var t = A, n = t.e;
	if (n !== null) {
		t.e = null;
		for (var r of n) bn(r);
	}
	return e !== void 0 && (t.x = e), t.i = !0, A = t.p, qe(e);
}
function qe(e = {}) {
	return i(e, le, { value: !0 }), e;
}
function Je() {
	return !0;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/task.js
var Ye = [];
function Xe() {
	var e = Ye;
	Ye = [], f(e);
}
function Ze(e) {
	if (Ye.length === 0 && !Tt) {
		var t = Ye;
		queueMicrotask(() => {
			t === Ye && Xe();
		});
	}
	Ye.push(e);
}
function Qe() {
	for (; Ye.length > 0;) Xe();
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/status.js
var $e = ~(_ | v | g);
function j(e, t) {
	e.f = e.f & $e | t;
}
function et(e) {
	e.f & 512 || e.deps === null ? j(e, g) : j(e, v);
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/utils.js
function tt(e, t, n) {
	e.f & 2048 ? t.add(e) : e.f & 4096 && n.add(e), j(e, g);
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/misc.js
function nt(e, t) {
	if (t) {
		let t = document.body;
		e.autofocus = !0, Ze(() => {
			document.activeElement === t && e.focus();
		});
	}
}
function rt(e) {
	T && /* @__PURE__ */ an(e) !== null && cn(e);
}
var it = !1;
function at() {
	it || (it = !0, document.addEventListener("reset", (e) => {
		Promise.resolve().then(() => {
			if (!e.defaultPrevented) for (let t of e.target.elements) t[ge]?.();
		});
	}, { capture: !0 }));
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/bindings/shared.js
function ot(e) {
	var t = H, n = U;
	Un(null), Wn(null);
	try {
		return e();
	} finally {
		Un(t), Wn(n);
	}
}
function st(e, t, n, r = n) {
	e.addEventListener(t, () => ot(n));
	let i = e[ge];
	e[ge] = i ? () => {
		i(), r(!0);
	} : () => r(!0), at();
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/async.js
function ct(e, t, n, r) {
	let i = Je() ? ft : ht;
	var a = e.filter((e) => !e.settled), o = t.map(i);
	if (n.length === 0 && a.length === 0) {
		r(o);
		return;
	}
	var s = U, c = lt(), l = a.length === 1 ? a[0].promise : a.length > 1 ? Promise.all(a.map((e) => e.promise)) : null;
	function u(e) {
		if (!(s.f & 16384)) {
			c();
			try {
				r([...o, ...e]);
			} catch (e) {
				pn(e, s);
			}
			ut();
		}
	}
	var d = dt();
	if (n.length === 0) {
		l.then(() => u([])).finally(d);
		return;
	}
	function f() {
		Promise.all(n.map((e) => /* @__PURE__ */ mt(e))).then(u).catch((e) => pn(e, s)).finally(d);
	}
	l ? l.then(() => {
		c(), f(), ut();
	}) : f();
}
function lt() {
	var e = U, t = H, n = A, r = N;
	return function(i = !0) {
		Wn(e), Un(t), We(n), i && !(e.f & 16384) && (r?.activate(), r?.apply());
	};
}
function ut(e = !0) {
	Wn(null), Un(null), We(null), e && N?.deactivate();
}
function dt() {
	var e = U, t = e.b, n = N, r = !!t?.is_rendered();
	return t?.update_pending_count(1, n), n.increment(r, e), () => {
		t?.update_pending_count(-1, n), n.decrement(r, e);
	};
}
/*#__NO_SIDE_EFFECTS__*/
function ft(e) {
	var t = 2 | _;
	return U !== null && (U.f |= re), {
		ctx: A,
		deps: null,
		effects: null,
		equals: Ae,
		f: t,
		fn: e,
		reactions: null,
		rv: 0,
		v: C,
		wv: 0,
		parent: U,
		ac: null
	};
}
var pt = Symbol("obsolete");
/*#__NO_SIDE_EFFECTS__*/
function mt(e, t, n) {
	let r = U;
	r === null && Pe();
	var i = void 0, a = Ht(C), o = !H, s = /* @__PURE__ */ new Set();
	return Cn(() => {
		var t = U, n = p();
		i = n.promise;
		try {
			Promise.resolve(e()).then(n.resolve, (e) => {
				e !== _e && n.reject(e);
			}).finally(ut);
		} catch (e) {
			n.reject(e), ut();
		}
		var c = N;
		if (o) {
			if (t.f & 32768) var l = dt();
			if (r.b?.is_rendered()) c.async_deriveds.get(t)?.reject(pt);
			else for (let e of s.values()) e.reject(pt);
			s.add(n), c.async_deriveds.set(t, n);
		}
		let u = (e, t = void 0) => {
			l?.(), s.delete(n), t !== pt && (c.activate(), t ? (a.f |= ce, Kt(a, t)) : (a.f & 8388608 && (a.f ^= ce), Kt(a, e)), c.deactivate());
		};
		n.promise.then(u, (e) => u(null, e || "unknown"));
	}), vn(() => {
		for (let e of s) e.reject(pt);
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
function M(e) {
	let t = /* @__PURE__ */ ft(e);
	return Kn(t), t;
}
/*#__NO_SIDE_EFFECTS__*/
function ht(e) {
	let t = /* @__PURE__ */ ft(e);
	return t.equals = Me, t;
}
function gt(e) {
	var t = e.effects;
	if (t !== null) {
		e.effects = null;
		for (var n = 0; n < t.length; n += 1) V(t[n]);
	}
}
function _t(e) {
	var t, n = U, r = e.parent;
	if (!Bn && r !== null && e.v !== C && r.f & 24576) return xe(), e.v;
	Wn(r);
	try {
		gt(e), t = ir(e);
	} finally {
		Wn(n);
	}
	return t;
}
function vt(e) {
	var t = _t(e);
	if (!e.equals(t) && (e.wv = tr(), (!N?.is_fork || e.deps === null) && (N === null ? e.v = t : (N.capture(e, t, !0), St?.capture(e, t, !0)), e.deps === null))) {
		j(e, g);
		return;
	}
	Bn || (Ct === null ? et(e) : (_n() || N?.is_fork) && Ct.set(e, t));
}
function yt(e) {
	if (e.effects !== null) for (let t of e.effects) (t.teardown || t.ac) && (t.teardown?.(), t.ac !== null && ot(() => {
		t.ac.abort(_e), t.ac = null;
	}), t.fn !== null && (t.teardown = d), sr(t, 0), kn(t));
}
function bt(e) {
	if (e.effects !== null) for (let t of e.effects) t.teardown && t.fn !== null && cr(t);
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/batch.js
var xt = null, N = null, St = null, Ct = null, wt = null, Tt = !1, Et = !1, Dt = null, Ot = null, kt = 0, At = 1, jt = class e {
	id = At++;
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
		xt === null ? xt = this : (xt.#n = this, this.#t = xt), xt = this;
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
			for (var r of n.d) j(r, _), t(r);
			for (r of n.m) j(r, v), t(r);
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
		for (let e of this.#u) this.#d.delete(e), j(e, _), this.schedule(e);
		for (let e of this.#d) j(e, v), this.schedule(e);
		this.apply();
		for (var t = Dt = [], n = [], r = Ot = []; this.#c.length > 0;) {
			kt++ > 1e3 && (this.#S(), Nt());
			for (let e of this.#g()) try {
				this.#v(e, t, n);
			} catch (t) {
				throw Rt(e), this.#h() || this.discard(), t;
			}
		}
		if (N = null, r.length > 0) {
			var i = e.ensure();
			for (let e of r) i.schedule(e);
		}
		if (Dt = null, Ot = null, this.#h()) {
			this.#x(n), this.#x(t);
			for (let [e, t] of this.#f) Lt(e, t);
			r.length > 0 && N.#_();
			return;
		}
		let a = this.#y();
		if (a) {
			this.#x(n), this.#x(t), a.#b(this);
			return;
		}
		this.#u.clear(), this.#d.clear();
		for (let e of this.#r) e(this);
		this.#r.clear(), St = this, Ft(n), Ft(t), St = null, this.#s?.resolve();
		var o = N;
		if (this.#a === 0 && (this.#c.length === 0 || o !== null) && this.#S(), this.#c.length > 0) {
			if (o !== null) {
				for (let e of this.#c) o.#c.push(e);
				this.#c = [];
			} else o = this;
		}
		o !== null && (Bt.clear(), o.#_());
	}
	#v(e, t, n) {
		e.f ^= g;
		for (var r = e.first; r !== null;) {
			var i = r.f, a = !!(i & 96);
			if (!(a && i & 1024 || i & 8192 || this.#f.has(r)) && r.fn !== null) {
				a ? r.f ^= g : i & 4 ? t.push(r) : nr(r) && (i & 16 && this.#d.add(r), cr(r));
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
					r & 4194320 && !this.async_deriveds.has(i) && (this.#d.delete(i), j(i, _), this.schedule(i));
				}
			}
		};
		for (let e of this.current.keys()) t(e);
		this.oncommit(() => e.discard()), e.#S(), N = this, this.#_();
	}
	#x(e) {
		for (var t = 0; t < e.length; t += 1) tt(e[t], this.#u, this.#d);
	}
	capture(e, t, n = !1) {
		e.v !== C && !this.previous.has(e) && this.previous.set(e, e.v), e.f & 8388608 || (this.current.set(e, [t, n]), Ct?.set(e, t)), this.is_fork || (e.v = t);
	}
	activate() {
		N = this;
	}
	deactivate() {
		N = null, Ct = null;
	}
	flush() {
		try {
			Et = !0, N = this, this.#_();
		} finally {
			kt = 0, wt = null, Dt = null, Ot = null, Et = !1, N = null, Ct = null, Bt.clear();
		}
	}
	discard() {
		for (let e of this.#i) e(this);
		this.#i.clear();
		for (let e of this.async_deriveds.values()) e.reject(pt);
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
		this.#m || (this.#m = !0, Ze(() => {
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
		if (N === null) {
			let t = N = new e();
			!Et && !Tt && Ze(() => {
				t.#e || t.flush();
			});
		}
		return N;
	}
	apply() {
		Ct = null;
	}
	schedule(e) {
		if (wt = e, e.b?.is_pending && e.f & 16777228 && !(e.f & 32768)) {
			e.b.defer_effect(e);
			return;
		}
		this.#c.push(e);
	}
	#S() {
		if (this.linked) {
			var e = this.#t, t = this.#n;
			e === null || (e.#n = t), t === null ? xt = e : t.#t = e, this.linked = !1;
		}
	}
};
function Mt(e) {
	var t = Tt;
	Tt = !0;
	try {
		var n;
		for (e && (N !== null && !N.is_fork && N.flush(), n = e());;) {
			if (Qe(), N === null) return n;
			N.flush();
		}
	} finally {
		Tt = t;
	}
}
function Nt() {
	try {
		ze();
	} catch (e) {
		pn(e, wt);
	}
}
var Pt = null;
function Ft(e) {
	var t = e.length;
	if (t !== 0) {
		for (var n = 0; n < t;) {
			var r = e[n++];
			if (!(r.f & 24576) && nr(r) && (Pt = /* @__PURE__ */ new Set(), cr(r), r.deps === null && r.first === null && r.nodes === null && r.teardown === null && r.ac === null && Mn(r), Pt?.size > 0)) {
				Bt.clear();
				for (let e of Pt) {
					if (e.f & 24576) continue;
					let t = [e], n = e.parent;
					for (; n !== null;) Pt.has(n) && (Pt.delete(n), t.push(n)), n = n.parent;
					for (let e = t.length - 1; e >= 0; e--) {
						let n = t[e];
						n.f & 24576 || cr(n);
					}
				}
				Pt.clear();
			}
		}
		Pt = null;
	}
}
function It(e) {
	N.schedule(e);
}
function Lt(e, t) {
	if (!(e.f & 32 && e.f & 1024)) {
		e.f & 2048 ? t.d.push(e) : e.f & 4096 && t.m.push(e), j(e, g);
		for (var n = e.first; n !== null;) Lt(n, t), n = n.next;
	}
}
function Rt(e) {
	j(e, g);
	for (var t = e.first; t !== null;) Rt(t), t = t.next;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/reactivity/sources.js
var zt = /* @__PURE__ */ new Set(), Bt = /* @__PURE__ */ new Map(), Vt = !1;
function Ht(e, t) {
	return {
		f: 0,
		v: e,
		reactions: null,
		equals: Ae,
		rv: 0,
		wv: 0
	};
}
/*#__NO_SIDE_EFFECTS__*/
function P(e, t) {
	let n = Ht(e, t);
	return Kn(n), n;
}
/*#__NO_SIDE_EFFECTS__*/
function Ut(e, t = !1, n = !0) {
	let r = Ht(e);
	return t || (r.equals = Me), r;
}
function F(e, t, n = !1) {
	return H !== null && (!Hn || H.f & 131072) && Je() && H.f & 4325394 && (Gn === null || !Gn.has(e)) && He(), Kt(e, n ? I(t) : t, Ot);
}
var Wt = null, Gt = 0;
function Kt(e, t, n = null) {
	if (!e.equals(t)) {
		Bn ? Bt.set(e, t) : Bt.has(e) || Bt.set(e, e.v);
		var r = jt.ensure();
		if (r.capture(e, t), e.f & 2) {
			let t = e;
			e.f & 2048 && _t(t), Ct === null && et(t);
		}
		e.wv = tr(), Wt = null, Gt = 0, Yt(e, _, n), Wt = null, Je() && U !== null && U.f & 1024 && !(U.f & 96) && (Yn === null ? Xn([e]) : Yn.push(e)), !r.is_fork && zt.size > 0 && !Vt && qt();
	}
	return t;
}
function qt() {
	Vt = !1;
	for (let e of zt) {
		e.f & 1024 && j(e, v);
		let t;
		try {
			t = nr(e);
		} catch {
			t = !0;
		}
		t && cr(e);
	}
	zt.clear();
}
function Jt(e) {
	F(e, e.v + 1);
}
function Yt(e, t, n) {
	var r = e.reactions;
	if (r !== null) {
		var i = Je(), a = r.length;
		if (Gt += a, Gt > 1e5 && Wt === null && (Wt = /* @__PURE__ */ new Set()), Wt !== null) {
			if (Wt.has(e)) return;
			Wt.add(e);
		}
		for (var o = 0; o < a; o++) {
			var s = r[o], c = s.f;
			if (i || s !== U) {
				var l = (c & _) === 0;
				if (l && j(s, t), c & 131072) zt.add(s);
				else if (c & 2) {
					var u = s;
					Ct?.delete(u), Yt(u, v, n);
				} else if (l) {
					var d = s;
					c & 16 && Pt !== null && Pt.add(d), n === null ? It(d) : n.push(d);
				}
			}
		}
	}
}
function I(t) {
	if (typeof t != "object" || !t || x in t || le in t) return t;
	let n = l(t);
	if (n !== s && n !== c) return t;
	var r = /* @__PURE__ */ new Map(), i = e(t), o = /* @__PURE__ */ P(0), u = null, d = $n, f = (e) => {
		if ($n === d) return e();
		var t = H, n = $n;
		Un(null), er(d);
		var r = e();
		return Un(t), er(n), r;
	};
	return i && r.set("length", /* @__PURE__ */ P(t.length, u)), new Proxy(t, {
		defineProperty(e, t, n) {
			(!("value" in n) || n.configurable === !1 || n.enumerable === !1 || n.writable === !1) && Be();
			var i = r.get(t);
			return i === void 0 ? f(() => {
				var e = /* @__PURE__ */ P(n.value, u);
				return r.set(t, e), e;
			}) : F(i, n.value, !0), !0;
		},
		deleteProperty(e, t) {
			var n = r.get(t);
			if (n === void 0) {
				if (t in e) {
					let e = f(() => /* @__PURE__ */ P(C, u));
					r.set(t, e), Jt(o);
				}
			} else F(n, C), Jt(o);
			return !0;
		},
		get(e, n, i) {
			if (n === x) return t;
			var o = r.get(n), s = n in e;
			if (o === void 0 && (!s || a(e, n)?.writable) && (o = f(() => /* @__PURE__ */ P(I(s ? e[n] : C), u)), r.set(n, o)), o !== void 0) {
				var c = W(o);
				return c === C ? void 0 : c;
			}
			return Reflect.get(e, n, i);
		},
		getOwnPropertyDescriptor(e, t) {
			this.has?.(e, t);
			var n = Reflect.getOwnPropertyDescriptor(e, t), i = r.get(t);
			if (i !== void 0) {
				var a = W(i);
				if (a === C) return;
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
			if (t === x) return !0;
			var n = r.get(t), i = n !== void 0 && n.v !== C || Reflect.has(e, t);
			return (n !== void 0 || U !== null && (!i || a(e, t)?.writable)) && (n === void 0 && (n = f(() => /* @__PURE__ */ P(i ? I(e[t]) : C, u)), r.set(t, n)), W(n) === C) ? !1 : i;
		},
		set(e, t, n, s) {
			var c = r.get(t), l = t in e;
			if (i && t === "length") for (var d = n; d < c.v; d += 1) {
				var p = r.get(d + "");
				p === void 0 ? d in e && (p = f(() => /* @__PURE__ */ P(C, u)), r.set(d + "", p)) : F(p, C);
			}
			if (c === void 0) (!l || a(e, t)?.writable) && (c = f(() => /* @__PURE__ */ P(void 0, u)), F(c, I(n)), r.set(t, c));
			else {
				l = c.v !== C;
				var m = f(() => I(n));
				F(c, m);
			}
			var h = Reflect.getOwnPropertyDescriptor(e, t);
			if (h?.set && h.set.call(s, n), !l) {
				if (i && typeof t == "string") {
					var g = r.get("length"), _ = Number(t);
					Number.isInteger(_) && _ >= g.v && F(g, _ + 1);
				}
				Jt(o);
			}
			return !0;
		},
		ownKeys(e) {
			W(o);
			var t = Reflect.ownKeys(e).filter((e) => {
				var t = r.get(e);
				return t === void 0 || t.v !== C;
			});
			for (var [n, i] of r) i.v !== C && !(n in e) && t.push(n);
			return t;
		},
		setPrototypeOf() {
			Ve();
		}
	});
}
function Xt(e) {
	try {
		if (typeof e == "object" && e && x in e) return e[x];
	} catch {}
	return e;
}
function Zt(e, t) {
	return Object.is(Xt(e), Xt(t));
}
var Qt, $t, en, tn;
function nn() {
	if (Qt === void 0) {
		Qt = window, $t = /Firefox/.test(navigator.userAgent);
		var e = Element.prototype, t = Node.prototype, n = Text.prototype;
		en = a(t, "firstChild").get, tn = a(t, "nextSibling").get, u(e) && (e[pe] = void 0, e[fe] = null, e[me] = void 0, e.__e = void 0), u(n) && (n[he] = void 0);
	}
}
function rn(e = "") {
	return document.createTextNode(e);
}
/*@__NO_SIDE_EFFECTS__*/
function an(e) {
	return en.call(e);
}
/*@__NO_SIDE_EFFECTS__*/
function on(e) {
	return tn.call(e);
}
function L(e, t) {
	if (!T) return /* @__PURE__ */ an(e);
	var n = /* @__PURE__ */ an(E);
	if (n === null) n = E.appendChild(rn());
	else if (t && n.nodeType !== 3) {
		var r = rn();
		return n?.before(r), D(r), r;
	}
	return t && dn(n), D(n), n;
}
function sn(e, t = !1) {
	if (!T) {
		var n = /* @__PURE__ */ an(e);
		return n instanceof Comment && n.data === "" ? /* @__PURE__ */ on(n) : n;
	}
	if (t) {
		if (E?.nodeType !== 3) {
			var r = rn();
			return E?.before(r), D(r), r;
		}
		dn(E);
	}
	return E;
}
function R(e, t = !1) {
	if (!T) return /* @__PURE__ */ an(e);
	var n = L(e, t);
	return O(e), n;
}
function z(e, t = 1, n = !1) {
	let r = T ? E : e;
	for (var i; t--;) i = r, r = /* @__PURE__ */ on(r);
	if (!T) return r;
	if (n) {
		if (r?.nodeType !== 3) {
			var a = rn();
			return r === null ? i?.after(a) : r.before(a), D(a), a;
		}
		dn(r);
	}
	return D(r), r;
}
function cn(e) {
	e.textContent = "";
}
function ln() {
	return !1;
}
function un(e, t, n) {
	return t == null || t === "http://www.w3.org/1999/xhtml" ? n ? document.createElement(e, { is: n }) : document.createElement(e) : n ? document.createElementNS(t, e, { is: n }) : document.createElementNS(t, e);
}
function dn(e) {
	if (e.nodeValue.length < 65536) return;
	let t = e.nextSibling;
	for (; t !== null && t.nodeType === 3;) t.remove(), e.nodeValue += t.nodeValue, t = e.nextSibling;
}
function fn(e) {
	var t = U;
	if (t === null) return H.f |= ce, e;
	if (!(t.f & 32768) && !(t.f & 4)) throw e;
	pn(e, t);
}
function pn(e, t) {
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
//#region ui/node_modules/svelte/src/internal/client/reactivity/effects.js
function mn(e) {
	U === null && (H === null && Re(e), Le()), Bn && Ie(e);
}
function hn(e, t) {
	var n = t.last;
	n === null ? t.last = t.first = e : (n.next = e, e.prev = n, t.last = e);
}
function gn(e, t) {
	var n = U;
	n !== null && n.f & 8192 && (e |= y);
	var r = {
		ctx: A,
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
	N?.register_created_effect(r);
	var i = r;
	if (e & 4) Dt === null ? jt.ensure().schedule(r) : Dt.push(r);
	else if (t !== null) {
		try {
			cr(r);
		} catch (e) {
			throw V(r), e;
		}
		i.deps === null && i.teardown === null && i.nodes === null && i.first === i.last && !(i.f & 524288) && (i = i.first, e & 16 && e & 65536 && i !== null && (i.f |= ne));
	}
	if (i !== null && (i.parent = n, n !== null && hn(i, n), H !== null && H.f & 2 && !(e & 64))) {
		var a = H;
		(a.effects ??= []).push(i);
	}
	return r;
}
function _n() {
	return H !== null && !Hn;
}
function vn(e) {
	let t = gn(8, null);
	return j(t, g), t.teardown = e, t;
}
function yn(e) {
	mn("$effect");
	var t = U.f;
	if (!H && t & 32 && A !== null && !A.i) {
		var n = A;
		(n.e ??= []).push(e);
	} else return bn(e);
}
function bn(e) {
	return gn(4 | ie, e);
}
function xn(e) {
	jt.ensure();
	let t = gn(64 | re, e);
	return (e = {}) => new Promise((n) => {
		e.outro ? Nn(t, () => {
			V(t), n(void 0);
		}) : (V(t), n(void 0));
	});
}
function Sn(e) {
	return gn(4, e);
}
function Cn(e) {
	return gn(se | re, e);
}
function wn(e, t = 0) {
	return gn(8 | t, e);
}
function B(e, t = [], n = [], r = []) {
	ct(r, t, n, (t) => {
		gn(8, () => {
			e(...t.map(W));
		});
	});
}
function Tn(e, t = 0) {
	return gn(16 | t, e);
}
function En(e, t = 0) {
	return gn(h | t, e);
}
function Dn(e) {
	return gn(32 | re, e);
}
function On(e) {
	var t = e.teardown;
	if (t !== null) {
		let n = Bn, r = H;
		Vn(!0), Un(null);
		try {
			t.call(null);
		} catch (t) {
			pn(t, e.parent);
		} finally {
			Vn(n), Un(r);
		}
	}
}
function kn(e, t = !1) {
	var n = e.first;
	for (e.first = e.last = null; n !== null;) {
		let e = n.ac;
		e !== null && ot(() => {
			e.abort(_e);
		});
		var r = n.next;
		n.f & 64 ? n.parent = null : V(n, t), n = r;
	}
}
function An(e) {
	for (var t = e.first; t !== null;) {
		var n = t.next;
		t.f & 32 || V(t), t = n;
	}
}
function V(e, t = !0) {
	var n = !1;
	(t || e.f & 262144) && e.nodes !== null && e.nodes.end !== null && (jn(e.nodes.start, e.nodes.end), n = !0), e.f |= te, kn(e, t && !n), sr(e, 0);
	var r = e.nodes && e.nodes.t;
	if (r !== null) for (let e of r) e.stop();
	On(e), e.f ^= te, e.f |= ee;
	var i = e.parent;
	i !== null && i.first !== null && Mn(e), e.next = e.prev = e.teardown = e.ctx = e.deps = e.fn = e.nodes = e.ac = e.b = null;
}
function jn(e, t) {
	for (; e !== null;) {
		var n = e === t ? null : /* @__PURE__ */ on(e);
		e.remove(), e = n;
	}
}
function Mn(e) {
	var t = e.parent, n = e.prev, r = e.next;
	n !== null && (n.next = r), r !== null && (r.prev = n), t !== null && (t.first === e && (t.first = r), t.last === e && (t.last = n));
}
function Nn(e, t, n = !0) {
	var r = [];
	e.f |= 256, Pn(e, r, !0);
	var i = () => {
		n && V(e), t && t();
	}, a = r.length;
	if (a > 0) {
		var o = () => --a || i();
		for (var s of r) s.out(o);
	} else i();
}
function Pn(e, t, n) {
	if (!(e.f & 8192)) {
		e.f ^= y;
		var r = e.nodes && e.nodes.t;
		if (r !== null) for (let e of r) (e.is_global || n) && t.push(e);
		for (var i = e.first; i !== null;) {
			var a = i.next;
			if (!(i.f & 64)) {
				var o = !!(i.f & 65536) || !!(i.f & 32) && !!(e.f & 16);
				Pn(i, t, o ? n : !1);
			}
			i = a;
		}
	}
}
function Fn(e) {
	e.f &= -257, In(e, !0);
}
function In(e, t) {
	if (!(e.f & 256) && e.f & 8192) {
		e.f ^= y, e.f & 1024 || (j(e, _), jt.ensure().schedule(e));
		for (var n = e.first; n !== null;) {
			var r = n.next, i = !!(n.f & 65536) || !!(n.f & 32);
			In(n, i ? t : !1), n = r;
		}
		var a = e.nodes && e.nodes.t;
		if (a !== null) for (let e of a) (e.is_global || t) && e.in();
	}
}
function Ln(e, t) {
	if (e.nodes) for (var n = e.nodes.start, r = e.nodes.end; n !== null;) {
		var i = n === r ? null : /* @__PURE__ */ on(n);
		t.append(n), n = i;
	}
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/legacy.js
var Rn = null, zn = !1, Bn = !1;
function Vn(e) {
	Bn = e;
}
var H = null, Hn = !1;
function Un(e) {
	H = e;
}
var U = null;
function Wn(e) {
	U = e;
}
var Gn = null;
function Kn(e) {
	H !== null && (H.f & 2097152 || H.f & 2) && (Gn ??= /* @__PURE__ */ new Set()).add(e);
}
var qn = null, Jn = 0, Yn = null;
function Xn(e) {
	Yn = e;
}
var Zn = 1, Qn = 0, $n = Qn;
function er(e) {
	$n = e;
}
function tr() {
	return ++Zn;
}
function nr(e) {
	var t = e.f;
	if (t & 2048) return !0;
	if (t & 4096) {
		for (var n = e.deps, r = n.length, i = 0; i < r; i++) {
			var a = n[i];
			if (nr(a) && vt(a), a.wv > e.wv) return !0;
		}
		t & 512 && Ct === null && j(e, g);
	}
	return !1;
}
function rr(e, t, n = !0) {
	var r = e.reactions;
	if (r !== null && !(Gn !== null && Gn.has(e))) for (var i = 0; i < r.length; i++) {
		var a = r[i];
		a.f & 2 ? rr(a, t, !1) : t === a && (n ? j(a, _) : a.f & 1024 && j(a, v), It(a));
	}
}
function ir(e) {
	var t = qn, n = Jn, r = Yn, i = H, a = Gn, o = A, s = Hn, c = $n, l = e.f;
	qn = null, Jn = 0, Yn = null, H = l & 96 ? null : e, Gn = null, We(e.ctx), Hn = !1, $n = ++Qn, e.ac !== null && (ot(() => {
		e.ac.abort(_e);
	}), e.ac = null);
	try {
		e.f |= oe;
		var u = e.fn, d = u();
		e.f |= b;
		var f = ar(e);
		if (Je() && Yn !== null && !Hn && f !== null && !(e.f & 6146)) for (var p = 0; p < Yn.length; p++) rr(Yn[p], e);
		if (i !== null && i !== e) {
			if (Qn++, i.deps !== null) for (let e = 0; e < n; e += 1) i.deps[e].rv = Qn;
			if (t !== null) for (let e of t) e.rv = Qn;
			Yn !== null && (r === null ? r = Yn : r.push(...Yn));
		}
		return e.f & 8388608 && (e.f ^= ce), d;
	} catch (t) {
		return ar(e), fn(t);
	} finally {
		e.f ^= oe, qn = t, Jn = n, Yn = r, H = i, Gn = a, We(o), Hn = s, $n = c;
	}
}
function ar(e) {
	var t = e.deps, n = N?.is_fork;
	if (qn !== null) {
		var r;
		if (n || sr(e, Jn), t !== null && Jn > 0) for (t.length = Jn + qn.length, r = 0; r < qn.length; r++) t[Jn + r] = qn[r];
		else e.deps = t = qn;
		if (_n() && e.f & 512) for (r = Jn; r < t.length; r++) (t[r].reactions ??= []).push(e);
	} else !n && t !== null && Jn < t.length && (sr(e, Jn), t.length = Jn);
	return t;
}
function or(e, r) {
	let i = r.reactions;
	if (i !== null) {
		var a = t.call(i, e);
		if (a !== -1) {
			var o = i.length - 1;
			o === 0 ? i = r.reactions = null : (i[a] = i[o], i.pop());
		}
	}
	if (i === null && r.f & 2 && (qn === null || !n.call(qn, r))) {
		var s = r;
		s.f & 512 && (s.f ^= 512), s.v !== C && et(s), s.ac !== null && ot(() => {
			s.ac.abort(_e), s.ac = null, j(s, _);
		}), yt(s), sr(s, 0);
	}
}
function sr(e, t) {
	var n = e.deps;
	if (n !== null) for (var r = t; r < n.length; r++) or(e, n[r]);
}
function cr(e) {
	var t = e.f;
	if (!(t & 16384)) {
		j(e, g);
		var n = U, r = zn;
		U = e, zn = !(t & 96);
		try {
			t & 16777232 ? An(e) : kn(e), On(e);
			var i = ir(e);
			e.teardown = typeof i == "function" ? i : null, e.wv = Zn;
		} finally {
			zn = r, U = n;
		}
	}
}
async function lr() {
	await Promise.resolve(), Mt();
}
function W(e) {
	var t = !!(e.f & 2);
	if (Rn?.add(e), H !== null && !Hn && !(U !== null && U.f & 16384) && (Gn === null || !Gn.has(e))) {
		var r = H.deps;
		if (H.f & 2097152) e.rv < Qn && (e.rv = Qn, qn === null && r !== null && r[Jn] === e ? Jn++ : qn === null ? qn = [e] : qn.push(e));
		else {
			H.deps ??= [], n.call(H.deps, e) || H.deps.push(e);
			var i = e.reactions;
			i === null ? e.reactions = [H] : n.call(i, H) || i.push(H);
		}
	}
	if (Bn && Bt.has(e)) return Bt.get(e);
	if (t) {
		var a = e;
		if (Bn) {
			var o = a.v;
			return (!(a.f & 1024) && a.reactions !== null || dr(a)) && (o = _t(a)), Bt.set(a, o), o;
		}
		var s = !(a.f & 512) && !Hn && H !== null && (zn || !!(H.f & 512)), c = (a.f & b) === 0;
		nr(a) && (s && (a.f |= 512), vt(a)), s && !c && (bt(a), ur(a));
	}
	if (Ct?.has(e)) return Ct.get(e);
	if (e.f & 8388608) throw e.v;
	return e.v;
}
function ur(e) {
	if (e.f |= 512, e.deps !== null) for (let t of e.deps) (t.reactions ??= []).push(e), t.f & 2 && !(t.f & 512) && (bt(t), ur(t));
}
function dr(e) {
	if (e.v === C) return !0;
	if (e.deps === null) return !1;
	for (let t of e.deps) if (Bt.has(t) || t.f & 2 && dr(t)) return !0;
	return !1;
}
function G(e) {
	var t = Hn;
	try {
		return Hn = !0, e();
	} finally {
		Hn = t;
	}
}
function fr(e) {
	if (!(typeof e != "object" || !e || e instanceof EventTarget)) {
		if (x in e) pr(e);
		else if (!Array.isArray(e)) for (let t in e) {
			let n = e[t];
			typeof n == "object" && n && x in n && pr(n);
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
//#region ui/node_modules/svelte/src/internal/client/dev/css.js
var Sr = Symbol("events"), Cr = /* @__PURE__ */ new Set(), wr = /* @__PURE__ */ new Set();
function Tr(e, t, n, r = {}) {
	function i(e) {
		if (r.capture || Ar.call(t, e), !e.cancelBubble) return ot(() => n?.call(this, e));
	}
	return e.startsWith("pointer") || e.startsWith("touch") || e === "wheel" ? (i.__removed = !1, Ze(() => {
		i.__removed || t.addEventListener(e, i, r);
	})) : t.addEventListener(e, i, r), i;
}
function Er(e, t, n, r, i) {
	var a = {
		capture: r,
		passive: i
	}, o = Tr(e, t, n, a);
	(t === document.body || t === window || t === document || t instanceof HTMLMediaElement) && vn(() => {
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
		var d = H, f = U;
		Un(null), Wn(null);
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
			e[Sr] = t, delete e.currentTarget, Un(d), Wn(f);
		}
	}
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/reconciler.js
var jr = globalThis?.window?.trustedTypes && /* @__PURE__ */ globalThis.window.trustedTypes.createPolicy("svelte-trusted-html", { createHTML: (e) => e });
function Mr(e) {
	return jr?.createHTML(e) ?? e;
}
function Nr(e) {
	var t = un("template");
	return t.innerHTML = Mr(e.replaceAll("<!>", "<!---->")), t.content;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/template.js
function Pr(e, t) {
	var n = U;
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
		if (T) return Pr(E, null), E;
		i === void 0 && (i = Nr(a ? e : "<!>" + e), n || (i = /* @__PURE__ */ an(i)));
		var t = r || $t ? document.importNode(i, !0) : i.cloneNode(!0);
		if (n) {
			var o = /* @__PURE__ */ an(t), s = t.lastChild;
			Pr(o, s);
		} else Pr(t, t);
		return t;
	};
}
function Fr() {
	if (T) return Pr(E, null), E;
	var e = document.createDocumentFragment(), t = document.createComment(""), n = rn();
	return e.append(t, n), Pr(t, n), e;
}
function J(e, t) {
	if (T) {
		var n = U;
		(!(n.f & 32768) || n.nodes.end === null) && (n.nodes.end = E), Ee();
		return;
	}
	e !== null && e.before(t);
}
//#endregion
//#region ui/node_modules/svelte/src/reactivity/create-subscriber.js
function Ir(e) {
	let t = 0, n = Ht(0), r;
	return () => {
		_n() && (W(n), wn(() => (t === 0 && (r = G(() => e(() => Jt(n)))), t += 1, () => {
			Ze(() => {
				--t, t === 0 && (r?.(), r = void 0, Jt(n));
			});
		})));
	};
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/blocks/boundary.js
var Lr = ne | re;
function Rr(e, t, n, r) {
	new zr(e, t, n, r);
}
var zr = class {
	parent;
	is_pending = !1;
	transform_error;
	#e;
	#t = T ? E : null;
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
	#h = Ir(() => (this.#m = Ht(this.#l), () => {
		this.#m = null;
	}));
	constructor(e, t, n, r) {
		this.#e = e, this.#n = t, this.#r = (e) => {
			var t = U;
			t.b = this, t.f |= 128, n(e);
		}, this.parent = U.b, this.transform_error = r ?? this.parent?.transform_error ?? ((e) => e), this.#i = Tn(() => {
			if (T) {
				let e = this.#t;
				Ee();
				let t = e.data === "[!";
				if (e.data.startsWith("[?")) {
					let t = JSON.parse(e.data.slice(2));
					this.#_(t);
				} else t ? this.#y() : this.#g();
			} else this.#b();
		}, Lr), T && (this.#e = E);
	}
	#g() {
		try {
			this.#a = Dn(() => this.#r(this.#e));
		} catch (e) {
			this.error(e);
		}
	}
	#_(e) {
		let t = this.#n.failed, { reset: n, invoke_onerror: r } = this.#v(e);
		Ze(r), t && (this.#s = Dn(() => {
			t(this.#e, () => e, () => n);
		}));
	}
	#v(e) {
		var t = !1, n = !1;
		let r = () => {
			if (t) {
				we();
				return;
			}
			t = !0, n && Ue(), this.#s !== null && Nn(this.#s, () => {
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
					pn(e, this.#i && this.#i.parent);
				}
			}
		};
	}
	#y() {
		let e = this.#n.pending;
		e && (this.is_pending = !0, this.#o = Dn(() => e(this.#e)), Ze(() => {
			var e = this.#c = document.createDocumentFragment(), t = rn(), n = !1;
			if (e.append(t), this.#a = this.#S(() => {
				try {
					return Dn(() => this.#r(t));
				} catch (e) {
					try {
						this.error(e), n = !0;
					} catch (e) {
						pn(e, this.#i.parent);
					}
					return null;
				}
			}), this.#a === null) {
				this.#c = null, n && this.#x(N);
				return;
			}
			this.#u === 0 && (this.#e.before(e), this.#c = null, Nn(this.#o, () => {
				this.#o = null;
			}), this.#x(N));
		}));
	}
	#b() {
		try {
			if (this.is_pending = this.has_pending_snippet(), this.#u = 0, this.#l = 0, this.#a = Dn(() => {
				this.#r(this.#e);
			}), this.#u > 0) {
				var e = this.#c = document.createDocumentFragment();
				Ln(this.#a, e);
				let t = this.#n.pending;
				this.#o = Dn(() => t(this.#e));
			} else this.#x(N);
		} catch (e) {
			this.error(e);
		}
	}
	#x(e) {
		this.is_pending = !1, e.transfer_effects(this.#f, this.#p);
	}
	defer_effect(e) {
		tt(e, this.#f, this.#p);
	}
	is_rendered() {
		return !this.is_pending && (!this.parent || this.parent.is_rendered());
	}
	has_pending_snippet() {
		return !!this.#n.pending;
	}
	#S(e) {
		var t = U, n = H, r = A;
		Wn(this.#i), Un(this.#i), We(this.#i.ctx);
		try {
			return jt.ensure(), e();
		} finally {
			Wn(t), Un(n), We(r);
		}
	}
	#C(e, t) {
		if (!this.has_pending_snippet()) {
			this.parent && this.parent.#C(e, t);
			return;
		}
		this.#u += e, this.#u === 0 && (this.#x(t), this.#o && Nn(this.#o, () => {
			this.#o = null;
		}), this.#c &&= (this.#e.before(this.#c), null));
	}
	update_pending_count(e, t) {
		this.#C(e, t), this.#l += e, !(!this.#m || this.#d) && (this.#d = !0, Ze(() => {
			this.#d = !1, this.#m && Kt(this.#m, this.#l);
		}));
	}
	get_effect_pending() {
		return this.#h(), W(this.#m);
	}
	error(e) {
		if (!this.#n.onerror && !this.#n.failed) throw e;
		N?.is_fork ? (this.#a && N.skip_effect(this.#a), this.#o && N.skip_effect(this.#o), this.#s && N.skip_effect(this.#s), N.oncommit(() => {
			this.#w(e);
		})) : this.#w(e);
	}
	#w(e) {
		this.#a &&= (V(this.#a), null), this.#o &&= (V(this.#o), null), this.#s &&= (V(this.#s), null), T && (D(this.#t), De(), D(Oe()));
		let t = this.#n.failed, n = (e) => {
			let { reset: n, invoke_onerror: r } = this.#v(e);
			r(), t && (this.#s = this.#S(() => {
				try {
					return Dn(() => {
						var r = U;
						r.b = this, r.f |= 128, t(this.#e, () => e, () => n);
					});
				} catch (e) {
					return pn(e, this.#i.parent), null;
				}
			}));
		};
		Ze(() => {
			var t;
			try {
				t = this.transform_error(e);
			} catch (e) {
				pn(e, this.#i && this.#i.parent);
				return;
			}
			typeof t == "object" && t && typeof t.then == "function" ? t.then(n, (e) => pn(e, this.#i && this.#i.parent)) : n(t);
		});
	}
};
function Y(e, t) {
	var n = t == null ? "" : typeof t == "object" ? `${t}` : t;
	n !== (e[he] ??= e.nodeValue) && (e[he] = n, e.nodeValue = `${n}`);
}
function Br(e, t) {
	return Hr(e, t);
}
var Vr = /* @__PURE__ */ new Map();
function Hr(e, { target: t, anchor: n, props: i = {}, events: a, context: o, intro: s = !0, transformError: c }) {
	nn();
	var l = void 0, u = xn(() => {
		var s = n ?? t.appendChild(rn());
		Rr(s, { pending: () => {} }, (t) => {
			Ge({});
			var n = A;
			if (o && (n.c = o), a && (i.$$events = a), T && Pr(t, null), l = e(t, i) || qe(), T && (U.nodes.end = E, E === null || E.nodeType !== 8 || E.data !== "]")) throw Se(), S;
			Ke();
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
//#region ui/node_modules/svelte/src/internal/client/dom/blocks/branches.js
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
			if (n) Fn(n), this.#r.delete(t);
			else {
				var r = this.#n.get(t);
				r && (Fn(r.effect), this.#t.set(t, r.effect), this.#n.delete(t), r.fragment.lastChild.remove(), this.anchor.before(r.fragment), n = r.effect);
			}
			for (let [t, n] of this.#e) {
				if (this.#e.delete(t), t === e) break;
				let r = this.#n.get(n);
				r && (V(r.effect), this.#n.delete(n));
			}
			for (let [e, r] of this.#t) {
				if (e === t || this.#r.has(e)) continue;
				let i = () => {
					if (Array.from(this.#e.values()).includes(e)) {
						var t = document.createDocumentFragment();
						Ln(r, t), t.append(rn()), this.#n.set(e, {
							effect: r,
							fragment: t
						});
					} else V(r);
					this.#r.delete(e), this.#t.delete(e);
				};
				this.#i || !n ? (this.#r.add(e), Nn(r, i, !1)) : i();
			}
		}
	};
	#o = (e) => {
		this.#e.delete(e);
		let t = Array.from(this.#e.values());
		for (let [e, n] of this.#n) t.includes(e) || (V(n.effect), this.#n.delete(e));
	};
	ensure(e, t) {
		var n = N, r = ln();
		if (t && !this.#t.has(e) && !this.#n.has(e)) {
			if (r) {
				var i = document.createDocumentFragment(), a = rn();
				i.append(a), this.#n.set(e, {
					effect: Dn(() => t(a)),
					fragment: i
				});
			} else this.#t.set(e, Dn(() => t(this.anchor)));
		}
		if (this.#e.set(n, e), r) {
			for (let [t, r] of this.#t) t === e ? n.unskip_effect(r) : n.skip_effect(r);
			for (let [t, r] of this.#n) t === e ? n.unskip_effect(r.effect) : n.skip_effect(r.effect);
			n.oncommit(this.#a), n.ondiscard(this.#o);
		} else T && (this.anchor = E), this.#a(n);
	}
};
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/blocks/if.js
function X(e, t, n = !1) {
	var r;
	T && (r = E, Ee());
	var i = new Gr(e), a = n ? ne : 0;
	function o(e, t) {
		if (T) {
			var n = ke(r);
			if (e !== parseInt(n.substring(1))) {
				var a = Oe();
				D(a), i.anchor = a, Te(!1), i.ensure(e, t), Te(!0);
				return;
			}
		}
		i.ensure(e, t);
	}
	Tn(() => {
		var e = !1;
		t((t, n = 0) => {
			e = !0, o(n, t);
		}), e || o(-1, null);
	}, a);
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/blocks/key.js
var Kr = Symbol("NaN");
function qr(e, t, n) {
	T && Ee();
	var r = new Gr(e), i = !Je();
	Tn(() => {
		var e = t();
		e !== e && (e = Kr), i && typeof e == "object" && e && (e = {}), r.ensure(e, n);
	});
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/blocks/each.js
function Jr(e, t) {
	return t;
}
function Yr(e, t, n) {
	for (var i = [], a = t.length, o, s = t.length, c = 0; c < a; c++) {
		let n = t[c];
		Nn(n, () => {
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
			cn(d), d.append(u), e.items.clear();
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
		r?.has(a) ? (a.f |= ae, Ln(a, document.createDocumentFragment())) : V(t[i], n);
	}
}
var Zr;
function Z(t, n, i, a, o, s = null) {
	var c = t, l = /* @__PURE__ */ new Map();
	if (n & 4) {
		var u = t;
		c = T ? D(/* @__PURE__ */ an(u)) : u.appendChild(rn());
	}
	T && Ee();
	var d = null, f = /* @__PURE__ */ ht(() => {
		var t = i();
		return e(t) ? t : t == null ? [] : r(t);
	}), p, m = /* @__PURE__ */ new Map(), h = !0;
	function g(e) {
		v.effect.f & 16384 || (v.pending.delete(e), v.fallback = d, $r(v, p, c, n, a), d !== null && (p.length === 0 ? d.f & 33554432 ? (d.f ^= ae, ti(d, null, c)) : Fn(d) : Nn(d, () => {
			d = null;
		})));
	}
	function _(e) {
		v.pending.delete(e);
	}
	var v = {
		effect: Tn(() => {
			p = W(f);
			var e = p.length;
			let t = !1;
			T && ke(c) === "[!" != (e === 0) && (c = Oe(), D(c), Te(!1), t = !0);
			for (var r = /* @__PURE__ */ new Set(), u = N, v = ln(), y = 0; y < e; y += 1) {
				T && E.nodeType === 8 && E.data === "]" && (c = E, t = !0, Te(!1));
				var ee = p[y], b = a(ee, y), te = h ? null : l.get(b);
				te ? (te.v && Kt(te.v, ee), te.i && Kt(te.i, y), v && u.unskip_effect(te.e)) : (te = ei(l, h ? c : Zr ??= rn(), ee, b, y, o, n, i), h || (te.e.f |= ae), l.set(b, te)), r.add(b);
			}
			if (e === 0 && s && !d && (h ? d = Dn(() => s(c)) : (d = Dn(() => s(Zr ??= rn())), d.f |= ae)), e > r.size && Fe("", "", ""), T && e > 0 && D(Oe()), !h) {
				if (m.set(u, r), v) {
					for (let [e, t] of l) r.has(e) || u.skip_effect(t.e);
					u.oncommit(g), u.ondiscard(_);
				} else g(u);
			}
			t && Te(!0), W(f);
		}),
		flags: n,
		items: l,
		pending: m,
		outrogroups: null,
		fallback: d
	};
	h = !1, T && (c = E);
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
		if (_.f & 8192 && (Fn(_), o && (_.nodes?.a?.unfix(), (f ??= /* @__PURE__ */ new Set()).delete(_))), _.f & 33554432) {
			if (_.f ^= ae, _ === l) ti(_, null, n);
			else {
				var y = d ? d.next : l;
				_ === e.effect.last && (e.effect.last = _.prev), _.prev && (_.prev.next = _.next), _.next && (_.next.prev = _.prev), ni(e, d, _), ni(e, _, y), ti(_, y, n), d = _, p = [], m = [], l = Qr(d.next);
				continue;
			}
		}
		if (_ !== l) {
			if (u !== void 0 && u.has(_)) {
				if (p.length < m.length) {
					var ee = m[0], b;
					d = ee.prev;
					var te = p[0], ne = p[p.length - 1];
					for (b = 0; b < p.length; b += 1) ti(p[b], ee, n);
					for (b = 0; b < m.length; b += 1) u.delete(m[b]);
					ni(e, te.prev, ne.next), ni(e, d, te), ni(e, ne, ee), l = ee, d = ne, --v, p = [], m = [];
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
		var re = [];
		if (u !== void 0) for (_ of u) _.f & 8192 || re.push(_);
		for (; l !== null;) !(l.f & 8192) && l !== e.fallback && re.push(l), l = Qr(l.next);
		var ie = re.length;
		if (ie > 0) {
			var oe = i & 4 && s === 0 ? n : null;
			if (o) {
				for (v = 0; v < ie; v += 1) re[v].nodes?.a?.measure();
				for (v = 0; v < ie; v += 1) re[v].nodes?.a?.fix();
			}
			Yr(e, re, oe);
		}
	}
	o && Ze(() => {
		if (f !== void 0) for (_ of f) _.nodes?.a?.apply();
	});
}
function ei(e, t, n, r, i, a, o, s) {
	var c = o & 1 ? o & 16 ? Ht(n) : /* @__PURE__ */ Ut(n, !1, !1) : null, l = o & 2 ? Ht(i) : null;
	return {
		v: c,
		i: l,
		e: Dn(() => (a(t, c ?? n, l ?? i, s), () => {
			e.delete(r);
		}))
	};
}
function ti(e, t, n) {
	if (e.nodes) for (var r = e.nodes.start, i = e.nodes.end, a = t && !(t.f & 33554432) ? t.nodes.start : n; r !== null;) {
		var o = /* @__PURE__ */ on(r);
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
		T && (o = D(/* @__PURE__ */ an(c)));
	}
	B(() => {
		var e = U;
		if (s === (s = t() ?? "")) {
			T && Ee();
			return;
		}
		if (n && !T) {
			e.nodes = null, c.innerHTML = s, s !== "" && Pr(/* @__PURE__ */ an(c), c.lastChild);
			return;
		}
		if (e.nodes !== null && (jn(e.nodes.start, e.nodes.end), e.nodes = null), s !== "") {
			if (T) {
				for (var a = E.data, l = Ee(), u = l; l !== null && (l.nodeType !== 8 || l.data !== "");) u = l, l = /* @__PURE__ */ on(l);
				if (l === null) throw Se(), S;
				Pr(E, u), o = D(l);
				return;
			}
			var d = un(r ? "svg" : i ? "math" : "template", r ? be : i ? w : void 0);
			d.innerHTML = s;
			var f = r || i ? d : d.content;
			if (Pr(/* @__PURE__ */ an(f), f.lastChild), r || i) for (; /* @__PURE__ */ an(f);) o.before(/* @__PURE__ */ an(f));
			else o.before(f);
		}
	});
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/css.js
function ii(e, t) {
	Sn(() => {
		e = U?.parent?.nodes?.start ?? e;
		var n = e.getRootNode(), r = n.host ? n : n.head ?? n.ownerDocument.head;
		if (!r.querySelector("#" + t.hash)) {
			let e = un("style");
			e.id = t.hash, e.textContent = t.code, r.appendChild(e);
		}
	});
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/actions.js
function ai(e, t, n) {
	Sn(() => {
		var r = G(() => t(e, n?.()) || {});
		if (n && r?.update) {
			var i = !1, a = {};
			wn(() => {
				var e = n();
				fr(e), i && je(a, e) && (a = e, r.update(e));
			}), i = !0;
		}
		if (r?.destroy) return () => r.destroy();
	});
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/attachments.js
function oi(e, t) {
	var n = void 0, r;
	En(() => {
		n !== (n = t()) && (r &&= (V(r), null), n && (r = Dn(() => {
			Sn(() => n(e));
		})));
	});
}
//#endregion
//#region ui/node_modules/clsx/dist/clsx.mjs
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
//#region ui/node_modules/svelte/src/internal/shared/attributes.js
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
//#region ui/node_modules/svelte/src/internal/client/dom/elements/class.js
function Q(e, t, n, r, i, a) {
	var o = e[pe];
	if (T || o !== n || o === void 0) {
		var s = di(n, r, a);
		(!T || s !== e.getAttribute("class")) && (s == null ? e.removeAttribute("class") : t ? e.className = s : e.setAttribute("class", s)), e[pe] = n;
	} else if (a && i !== a) for (var c in a) {
		var l = !!a[c];
		(i == null || l !== !!i[c]) && e.classList.toggle(c, l);
	}
	return a;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/style.js
function hi(e, t = {}, n, r) {
	for (var i in n) {
		var a = n[i];
		t[i] !== a && (n[i] == null ? e.style.removeProperty(i) : e.style.setProperty(i, a, r));
	}
}
function gi(e, t, n, r) {
	var i = e[me];
	if (T || i !== t) {
		var a = mi(t, r);
		(!T || a !== e.getAttribute("style")) && (a == null ? e.removeAttribute("style") : e.style.cssText = a), e[me] = t;
	} else r && (Array.isArray(r) ? (hi(e, n?.[0], r[0]), hi(e, n?.[1], r[1], "important")) : hi(e, n, r));
	return r;
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/bindings/select.js
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
			_i(c, i ? a.includes(l) : Zt(l, r));
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
		if (!e(n)) return Ce();
		for (var i of t.options) i.selected = n.includes(Si(i));
		return;
	}
	for (i of t.options) if (Zt(Si(i), n)) {
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
	}), vn(() => {
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
//#region ui/node_modules/svelte/src/internal/client/dom/elements/attributes.js
var wi = Symbol("class"), Ti = Symbol("style"), Ei = Symbol("is custom element"), Di = Symbol("is html"), Oi = ve ? "link" : "LINK", ki = ve ? "input" : "INPUT", Ai = ve ? "option" : "OPTION", ji = ve ? "select" : "SELECT";
function Mi(e) {
	if (T) {
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
		e[ge] = n, Ze(n), at();
	}
}
function $(e, t, n, r) {
	var i = Fi(e);
	T && (i[t] = e.getAttribute(t), t === "src" || t === "srcset" || t === "href" && e.nodeName === Oi) || i[t] !== (i[t] = n) && (t === "loading" && (e[de] = n), n == null ? e.removeAttribute(t) : typeof n != "string" && Li(e).has(t) ? e[t] = n : e.setAttribute(t, n));
}
function Ni(e, t, n, r, i = !1, a = !1) {
	T && i && e.nodeName === ki && ("defaultValue" in n || "defaultChecked" in n || Mi(e));
	var o = Fi(e), s = o[Ei], c = !o[Di];
	let l = T && s;
	l && Te(!1);
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
				else if (i === "autofocus") nt(e, !!l);
				else if (!s && (i === "__value" || i === "value" && l != null)) e.value = e.__value = l;
				else if (i === "selected" && d) _i(e, l);
				else {
					var y = i;
					c || (y = yr(y));
					var ee = y === "defaultValue" || y === "defaultChecked";
					if (f && y === "defaultValue") continue;
					if (l == null && !s && !ee) {
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
					} else ee || (s || typeof l != "string") && m.has(y) ? (e[y] = l, y in o && (o[y] = C)) : typeof l != "function" && $(e, y, l, a);
				}
			}
		}
	}
	return l && Te(!0), u;
}
function Pi(e, t, n = [], r = [], i = [], a, o = !1, s = !1) {
	ct(i, n, r, (n) => {
		var r = void 0, i = {}, c = e.nodeName === ji, l = !1;
		if (En(() => {
			var u = t(...n.map(W)), d = Ni(e, r, u, a, o, s);
			if (l && c) {
				var f = e;
				"defaultValue" in u && vi(f, u.defaultValue), "value" in u && bi(f, u.value);
			}
			for (let e of Object.getOwnPropertySymbols(i)) u[e] || V(i[e]);
			for (let t of Object.getOwnPropertySymbols(u)) {
				var p = u[t];
				t.description === "@attach" && (!r || p !== r[t]) && (i[t] && V(i[t]), i[t] = Dn(() => oi(e, () => p))), d[t] = p;
			}
			r = d;
		}), c) {
			var u = e;
			Sn(() => {
				var e = r;
				"defaultValue" in e && vi(u, e.defaultValue), bi(u, e.value, !0), xi(u);
			});
		}
		l = !0;
	});
}
function Fi(e) {
	return e[fe] ??= {
		[Ei]: e.nodeName.includes("-"),
		[Di]: e.namespaceURI === ye
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
//#region ui/node_modules/svelte/src/internal/client/dom/elements/bindings/input.js
function Ri(e, t, n = t) {
	var r = /* @__PURE__ */ new WeakSet();
	st(e, "input", async (i) => {
		var a = i ? e.defaultValue : e.value;
		if (a = zi(e) ? Bi(a) : a, n(a), N !== null && r.add(N), await lr(), a !== (a = t())) {
			var o = e.selectionStart, s = e.selectionEnd, c = e.value.length;
			if (e.value = a ?? "", s !== null) {
				var l = e.value.length;
				o === s && s === c && l > c ? (e.selectionStart = l, e.selectionEnd = l) : (e.selectionStart = o, e.selectionEnd = Math.min(s, l));
			}
		}
	}), (T && e.defaultValue !== e.value || G(t) == null && e.value) && (n(zi(e) ? Bi(e.value) : e.value), N !== null && r.add(N)), wn(() => {
		var n = t();
		if (e === document.activeElement) {
			var i = N;
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
	Sn(() => (G(() => n(e[t])), r));
}
//#endregion
//#region ui/node_modules/svelte/src/internal/client/dom/elements/bindings/this.js
function Ui(e, t) {
	return e === t || e?.[x] === t;
}
function Wi(e = qe(), t, n, r) {
	var i = A.r, a = U;
	return Sn(() => {
		var o, s;
		return wn(() => {
			o = s, s = r?.() || [], G(() => {
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
//#region ui/node_modules/svelte/src/internal/client/reactivity/store.js
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
//#region ui/node_modules/svelte/src/internal/client/reactivity/props.js
function qi(e, t, n, r) {
	var i = !0, o = !!(n & 8), s = !!(n & 16), c = r, l = !0, u = void 0, d = () => s && i ? (u ??= /* @__PURE__ */ ft(r), W(u)) : (l && (l = !1, c = s ? G(r) : r), c);
	let f;
	if (o) {
		var p = x in e || ue in e;
		f = a(e, t)?.set ?? (p && t in e ? (n) => e[t] = n : void 0);
	}
	var m, h = !1;
	o ? [m, h] = Ki(() => e[t]) : m = e[t], m === void 0 && r !== void 0 && (m = d(), f && (i && k(t), f(m)));
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
	var v = !1, y = (n & 1 ? ft : ht)(() => (v = !1, g()));
	o && W(y);
	var ee = U;
	return (function(e, t) {
		if (arguments.length > 0) {
			let n = t ? W(y) : i && o ? I(e) : e;
			return F(y, n), v = !0, c !== void 0 && (c = n), e;
		}
		return Bn && v || ee.f & 16384 ? y.v : W(y);
	});
}
function Ji(e) {
	A === null && Ne("onMount"), yn(() => {
		let t = G(e);
		if (typeof t == "function") return t;
	});
}
//#endregion
//#region ui/node_modules/svelte/src/internal/disclose-version.js
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
		tableColumns: u("tableColumns")?.tableColumns,
		from: r.every((e) => e.from) ? r[0].from : void 0,
		homes: l(r.map((e) => e.homes ?? []), (e) => e.from),
		sorts: l(r.map((e) => e.sorts), (e) => e.id),
		search: r[0].search,
		empty: r.map((e) => e.empty).join(" "),
		emptyActions: u("emptyActions")?.emptyActions,
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
	Ge(t, !0), ii(e, Ta);
	let n = /* @__PURE__ */ P(!1), r = /* @__PURE__ */ P(0), i, a = /* @__PURE__ */ P(void 0), o = /* @__PURE__ */ M(() => t.options.find((e) => e.value === t.value));
	yn(() => {
		if (W(n)) return ba(() => F(n, !1));
	});
	function s() {
		F(r, Math.max(0, t.options.findIndex((e) => e.value === t.value)), !0), F(n, !0), requestAnimationFrame(() => W(a)?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
	}
	function c(e) {
		F(n, !1), t.options[e] && t.options[e].value !== t.value && t.onchange(t.options[e].value), i.querySelector("button")?.focus();
	}
	function l(e) {
		if (!W(n)) {
			[
				"Enter",
				" ",
				"ArrowDown",
				"ArrowUp"
			].includes(e.key) && (e.preventDefault(), s());
			return;
		}
		if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), F(n, !1);
		else if (e.key === "ArrowDown") e.preventDefault(), F(r, Math.min(t.options.length - 1, W(r) + 1), !0);
		else if (e.key === "ArrowUp") e.preventDefault(), F(r, Math.max(0, W(r) - 1), !0);
		else if (e.key === "Enter" || e.key === " ") e.preventDefault(), c(W(r));
		else if (e.key.length === 1) {
			let n = t.options.findIndex((t) => t.label.toLowerCase().startsWith(e.key.toLowerCase()));
			n >= 0 && F(r, n, !0);
		} else return;
		requestAnimationFrame(() => W(a)?.children[W(r)]?.scrollIntoView({ block: "nearest" }));
	}
	function u(e) {
		i.contains(e.relatedTarget) || F(n, !1);
	}
	var d = wa(), f = L(d), p = R(L(f), !0);
	De(2), O(f);
	var m = z(f, 2), h = (e) => {
		var n = Ca();
		Z(n, 23, () => t.options, (e) => e.value, (e, n, i) => {
			var a = Sa();
			let o;
			var s = L(a), l = R(s, !0), u = z(s), d = (e) => {
				var t = xa(), r = R(t, !0);
				B(() => Y(r, W(n).note)), J(e, t);
			};
			X(u, (e) => {
				W(n).note && e(d);
			}), O(a), B(() => {
				$(a, "aria-selected", W(n).value === t.value), o = Q(a, 1, "svelte-ifm9j5", null, o, {
					on: W(i) === W(r),
					cur: W(n).value === t.value
				}), Y(l, W(n).label);
			}), K("mousedown", a, (e) => {
				e.preventDefault(), c(W(i));
			}), K("mousemove", a, () => F(r, W(i), !0)), J(e, a);
		}), O(n), Wi(n, (e) => F(a, e), () => W(a)), J(e, n);
	};
	X(m, (e) => {
		W(n) && e(h);
	}), O(d), Wi(d, (e) => i = e, () => i), B(() => {
		$(f, "id", t.id), $(f, "aria-expanded", W(n)), $(f, "aria-label", t.label), $(f, "title", W(o)?.note), Y(p, W(o)?.label ?? t.value);
	}), K("focusout", d, u), K("click", f, () => W(n) ? F(n, !1) : s()), K("keydown", f, l), J(e, d), Ke();
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
	Ge(t, !0), ii(e, ja);
	let n = qi(t, "size", 3, 16);
	var r = Aa();
	let i;
	ri(r, () => ka(t.name, n()), !0), O(r), B(() => i = gi(r, "", i, {
		width: `calc(${n() ?? ""}px * var(--ui-scale, 1))`,
		height: `calc(${n() ?? ""}px * var(--ui-scale, 1))`
	})), J(e, r), Ke();
}
//#endregion
//#region plugins/beta/catalog/ui/src/Icon.svelte
function Na(e, t) {
	Ge(t, !0);
	let n = qi(t, "size", 3, 16);
	{
		let r = /* @__PURE__ */ M(() => Oa(t.name) ? t.name : "library");
		Ma(e, {
			get name() {
				return W(r);
			},
			get size() {
				return n();
			}
		});
	}
	Ke();
}
//#endregion
//#region plugins/beta/catalog/ui/src/LibraryCover.svelte
var Pa = /* @__PURE__ */ q("<img alt=\"\"/>"), Fa = /* @__PURE__ */ q("<div aria-hidden=\"true\"> </div>"), Ia = /* @__PURE__ */ q("<div><!></div>"), La = {
	hash: "svelte-enia8e",
	code: ".cover.svelte-enia8e {width:100%;aspect-ratio:2 / 3;object-fit:cover;border-radius:var(--radius-sm);background:var(--bg-alt);box-shadow:var(--shadow-sm);}.cover.big.svelte-enia8e {aspect-ratio:auto;max-height:280px;width:auto;max-width:100%;margin-bottom:10px;}.tile.svelte-enia8e {display:grid;place-items:center;font-size:2.2em;font-weight:600;box-shadow:none;background:hsl(var(--hue) 32% 50% / .22);color:hsl(var(--hue) 40% 42%);} /* literal: a hue per title */\n  /* the panel's: a tile its column's width while the picture is missing or on its way, not a blank column */.tile.big.svelte-enia8e {aspect-ratio:2 / 3;width:100%;max-height:240px;font-size:3em;}.wrap.svelte-enia8e {width:100%;min-height:1px;}"
};
function Ra(e, t) {
	Ge(t, !0), ii(e, La);
	let n = qi(t, "big", 3, !1), r = /* @__PURE__ */ P(null), i = /* @__PURE__ */ P(void 0);
	async function a(e) {
		let r = typeof e == "function" ? await e() : e;
		return r ? /^(https?:|data:|blob:)/i.test(r) ? r : t.kandinsky.thumbUrl(r.replace(/^!?\[\[|\]\]$/g, "").split("|")[0], n() ? 520 : 260) : null;
	}
	yn(() => {
		let e = t.cover, n = W(i);
		if (!n) return;
		let o = !0;
		F(r, null);
		let s = new IntersectionObserver((t) => {
			t.some((e) => e.isIntersecting) && (s.disconnect(), a(e).then((e) => {
				o && F(r, e, !0);
			}, () => {}));
		}, { rootMargin: "400px" });
		return s.observe(n), () => {
			o = !1, s.disconnect();
		};
	});
	let o = /* @__PURE__ */ M(() => t.title.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "?"), s = /* @__PURE__ */ M(() => [...t.title].reduce((e, t) => (e * 31 + t.charCodeAt(0)) % 360, 7));
	var c = Ia();
	let l;
	var u = L(c), d = (e) => {
		var t = Pa();
		let i;
		B(() => {
			i = Q(t, 1, "cover svelte-enia8e", null, i, { big: n() }), $(t, "src", W(r));
		}), J(e, t);
	}, f = (e) => {
		var t = Fa();
		let r, i;
		var a = R(t, !0);
		B(() => {
			r = Q(t, 1, "cover tile svelte-enia8e", null, r, { big: n() }), i = gi(t, "", i, { "--hue": W(s) }), Y(a, W(o));
		}), J(e, t);
	};
	X(u, (e) => {
		W(r) ? e(d) : e(f, -1);
	}), O(c), Wi(c, (e) => F(i, e), () => W(i)), B(() => l = Q(c, 1, "wrap svelte-enia8e", null, l, { big: n() })), J(e, c), Ke();
}
//#endregion
//#region plugins/beta/catalog/ui/src/Library.svelte
var za = /* @__PURE__ */ q("<button><!> </button>"), Ba = /* @__PURE__ */ q("<div class=\"drop-hint svelte-7gk24t\"> </div>"), Va = /* @__PURE__ */ q("<button role=\"radio\"> </button>"), Ha = /* @__PURE__ */ q("<div class=\"seg svelte-7gk24t\" role=\"radiogroup\" aria-label=\"Layout\"></div>"), Ua = /* @__PURE__ */ q("<button class=\"btn home svelte-7gk24t\"><!> <!></button>"), Wa = /* @__PURE__ */ q("<form class=\"add svelte-7gk24t\"><input spellcheck=\"false\" class=\"svelte-7gk24t\"/> <button class=\"btn primary svelte-7gk24t\"> </button></form>"), Ga = /* @__PURE__ */ q("<button> <span class=\"c svelte-7gk24t\"> </span></button>"), Ka = /* @__PURE__ */ q("<div class=\"types svelte-7gk24t\" role=\"toolbar\" aria-label=\"Type\"><button>All <span class=\"c svelte-7gk24t\"> </span></button> <!></div>"), qa = /* @__PURE__ */ q("<button class=\"btn primary svelte-7gk24t\"> </button>"), Ja = /* @__PURE__ */ q("<p class=\"muted pad svelte-7gk24t\"> <!></p>"), Ya = /* @__PURE__ */ q("<span class=\"bar svelte-7gk24t\"></span>"), Xa = /* @__PURE__ */ q("<button class=\"go svelte-7gk24t\"><!> <span class=\"t svelte-7gk24t\"></span> <!></button>"), Za = /* @__PURE__ */ q("<section class=\"continue svelte-7gk24t\" aria-label=\"Continue\"><h4 class=\"svelte-7gk24t\">Continue</h4> <div class=\"strip svelte-7gk24t\"></div></section>"), Qa = /* @__PURE__ */ q("<button class=\"twisty svelte-7gk24t\"><!></button>"), $a = /* @__PURE__ */ q("<span class=\"twisty svelte-7gk24t\"></span>"), eo = /* @__PURE__ */ q("<div class=\"tree-row svelte-7gk24t\"><!> <button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button></div>"), to = /* @__PURE__ */ q("<button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button>"), no = /* @__PURE__ */ q("<h4 class=\"svelte-7gk24t\"> </h4> <!>", 1), ro = /* @__PURE__ */ q("<button><span class=\"hash svelte-7gk24t\">#</span><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button>"), io = /* @__PURE__ */ q("<button class=\"h4 svelte-7gk24t\"><!>Tags <span class=\"c svelte-7gk24t\"> </span></button> <!>", 1), ao = /* @__PURE__ */ q("<nav class=\"side svelte-7gk24t\"><button><!><span class=\"n svelte-7gk24t\"> </span><span class=\"c svelte-7gk24t\"> </span></button> <!> <!></nav>"), oo = /* @__PURE__ */ q("<th scope=\"col\"><button type=\"button\" class=\"th-btn svelte-7gk24t\"><span class=\"svelte-7gk24t\"> </span><span class=\"sort-ind svelte-7gk24t\" aria-hidden=\"true\"> </span></button></th>"), so = /* @__PURE__ */ q("<td class=\"c-title svelte-7gk24t\"><button type=\"button\" class=\"row-focus svelte-7gk24t\"><span class=\"t svelte-7gk24t\"></span></button></td>"), co = /* @__PURE__ */ q("<span class=\"flag green svelte-7gk24t\">PDF</span>"), lo = /* @__PURE__ */ q("<span class=\"flag red svelte-7gk24t\">no PDF</span>"), uo = /* @__PURE__ */ q("<span class=\"muted\">—</span>"), fo = /* @__PURE__ */ q("<td class=\"c-pdf svelte-7gk24t\"><!></td>"), po = /* @__PURE__ */ q("<td> </td>"), mo = /* @__PURE__ */ q("<tr></tr>"), ho = /* @__PURE__ */ q("<div class=\"sr-only svelte-7gk24t\" role=\"status\"> </div> <table class=\"zot-table svelte-7gk24t\"><caption class=\"sr-only svelte-7gk24t\"> </caption><thead class=\"svelte-7gk24t\"><tr></tr></thead><tbody></tbody></table>", 1), go = /* @__PURE__ */ q("<button class=\"btn from-home svelte-7gk24t\"> <!></button>"), _o = /* @__PURE__ */ q("<div class=\"from-head svelte-7gk24t\" role=\"heading\" aria-level=\"3\"><!><span class=\"fh svelte-7gk24t\"> </span> <span class=\"fc svelte-7gk24t\"> </span> <!></div>"), vo = /* @__PURE__ */ q("<span class=\"m svelte-7gk24t\"> </span>"), yo = /* @__PURE__ */ q("<button><!> <!> <span class=\"t svelte-7gk24t\"></span> <!></button>"), bo = /* @__PURE__ */ q("<span> </span>"), xo = /* @__PURE__ */ q("<span class=\"flags svelte-7gk24t\"></span>"), So = /* @__PURE__ */ q("<button><span class=\"t svelte-7gk24t\"></span> <!> <!> <!></button>"), Co = /* @__PURE__ */ q("<!> <!>", 1), wo = /* @__PURE__ */ q("<div class=\"empty-actions svelte-7gk24t\"><!> <!></div>"), To = /* @__PURE__ */ q("<div class=\"empty-state pad none svelte-7gk24t\"><p class=\"muted svelte-7gk24t\"> </p> <!></div>"), Eo = /* @__PURE__ */ q("<li class=\"svelte-7gk24t\"></li>"), Do = /* @__PURE__ */ q("<li class=\"muted svelte-7gk24t\"> </li>"), Oo = /* @__PURE__ */ q("<aside class=\"detail many svelte-7gk24t\" aria-label=\"Picked\"><div class=\"kind svelte-7gk24t\"> </div> <ul class=\"picked svelte-7gk24t\"><!><!></ul> <div class=\"actions svelte-7gk24t\"><!><button class=\"btn svelte-7gk24t\">Clear</button></div></aside>"), ko = /* @__PURE__ */ q("<button class=\"scrim svelte-7gk24t\" aria-label=\"Close\"></button>"), Ao = /* @__PURE__ */ q("<button class=\"close icon-btn svelte-7gk24t\" aria-label=\"Close\" title=\"Close\"><!></button>"), jo = /* @__PURE__ */ q("<span class=\"hint svelte-7gk24t\"> </span>"), Mo = /* @__PURE__ */ q("<textarea class=\"svelte-7gk24t\"></textarea>"), No = /* @__PURE__ */ q("<input class=\"svelte-7gk24t\"/>"), Po = /* @__PURE__ */ q("<label> <!> <!></label>"), Fo = /* @__PURE__ */ q("<form class=\"edit svelte-7gk24t\"><!> <div class=\"actions svelte-7gk24t\"><button class=\"btn primary svelte-7gk24t\">Save</button><button type=\"button\" class=\"btn svelte-7gk24t\">Cancel</button></div></form>"), Io = /* @__PURE__ */ q("<div class=\"kind svelte-7gk24t\"> </div>"), Lo = /* @__PURE__ */ q("<p> </p>"), Ro = /* @__PURE__ */ q("<button class=\"btn svelte-7gk24t\" aria-label=\"More\"><!></button>"), zo = /* @__PURE__ */ q("<div class=\"facts-pic svelte-7gk24t\"><!></div>"), Bo = /* @__PURE__ */ q("<dt class=\"svelte-7gk24t\"> </dt><dd class=\"svelte-7gk24t\"> </dd>", 1), Vo = /* @__PURE__ */ q("<dl class=\"svelte-7gk24t\"></dl>"), Ho = /* @__PURE__ */ q("<div><!> <!></div>"), Uo = /* @__PURE__ */ q("<div class=\"choice svelte-7gk24t\" role=\"radiogroup\"><span class=\"svelte-7gk24t\"> </span> <!></div>"), Wo = /* @__PURE__ */ q("<a target=\"_blank\" rel=\"noreferrer\" class=\"svelte-7gk24t\"><!> </a>"), Go = /* @__PURE__ */ q("<div class=\"links svelte-7gk24t\"></div>"), Ko = /* @__PURE__ */ q("<button class=\"tag coll svelte-7gk24t\"><!> </button>"), qo = /* @__PURE__ */ q("<button class=\"tag svelte-7gk24t\"> </button>"), Jo = /* @__PURE__ */ q("<div class=\"tags svelte-7gk24t\"><!> <!></div>"), Yo = /* @__PURE__ */ q("<h3 class=\"svelte-7gk24t\"> </h3><p class=\"abstract svelte-7gk24t\"> </p>", 1), Xo = /* @__PURE__ */ q("<h3 class=\"svelte-7gk24t\">Your notes</h3><p class=\"abstract own svelte-7gk24t\"> </p><button class=\"kandinsky-btn more-notes svelte-7gk24t\">Open the notes</button>", 1), Zo = /* @__PURE__ */ q("<div></div>"), Qo = /* @__PURE__ */ q("<div class=\"links-bar svelte-7gk24t\"><!></div>"), $o = /* @__PURE__ */ q("<!> <aside class=\"detail svelte-7gk24t\"><!> <!> <!> <h2 class=\"svelte-7gk24t\"></h2> <!> <div class=\"actions svelte-7gk24t\"><!> <!></div> <!> <!> <!> <!> <!> <!> <!></aside>", 1), es = /* @__PURE__ */ q("<aside class=\"detail none svelte-7gk24t\" aria-label=\"Details\"><p> <span class=\"keys-only\"><br/>↑ ↓ move, Enter opens.</span></p></aside>"), ts = /* @__PURE__ */ q("<div tabindex=\"0\" role=\"application\"><!> <header class=\"svelte-7gk24t\"><h1 class=\"svelte-7gk24t\"><!> <span class=\"count svelte-7gk24t\"> </span></h1> <input class=\"search svelte-7gk24t\" spellcheck=\"false\"/> <!> <!> <!> <!> <!></header> <!> <!> <!> <div><!> <div><!></div> <!></div></div>"), ns = {
	hash: "svelte-7gk24t",
	code: ".types.svelte-7gk24t {display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 10px;}.chip.svelte-7gk24t {display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid var(--border);color:var(--text-muted);font-size:calc(12.5px * var(--ui-scale, 1));}.chip.svelte-7gk24t:hover {background:var(--bg-hover);color:var(--text);}.chip.on.svelte-7gk24t {background:var(--accent-soft);border-color:color-mix(in srgb, var(--accent) 45%, transparent);color:var(--accent);}.chip.svelte-7gk24t .c:where(.svelte-7gk24t) {color:var(--text-faint);font-variant-numeric:tabular-nums;}.library.svelte-7gk24t {height:100%;display:flex;flex-direction:column;background:var(--bg);outline:none;position:relative;}.library.dragging.svelte-7gk24t {box-shadow:inset 0 0 0 2px var(--accent);}.drop-hint.svelte-7gk24t {position:absolute;inset:0;z-index:5;display:grid;place-items:center;pointer-events:none;background:color-mix(in srgb, var(--bg) 70%, transparent);color:var(--accent);font-size:calc(16px * var(--ui-scale, 1));font-weight:600;}header.svelte-7gk24t {display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--border);}h1.svelte-7gk24t {display:inline-flex;gap:8px;align-items:center;margin:0 8px 0 0;font-size:calc(17px * var(--ui-scale, 1));color:var(--heading);}.count.svelte-7gk24t {font-size:.7em;font-weight:500;color:var(--text-faint);}input.svelte-7gk24t {font:inherit;font-size:calc(13px * var(--ui-scale, 1));color:var(--text);background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:5px 9px;}input.svelte-7gk24t:focus {outline:none;border-color:var(--accent);}.search.svelte-7gk24t {flex:1;min-width:220px;}.add.svelte-7gk24t {display:flex;gap:6px;}.add.svelte-7gk24t input:where(.svelte-7gk24t) {width:270px;} /* the placeholder whole (clipped text is a bug) */.seg.svelte-7gk24t {display:inline-flex;border:1px solid var(--border-strong);border-radius:var(--radius-sm);overflow:hidden;}.seg.svelte-7gk24t button:where(.svelte-7gk24t) {padding:4px 10px;color:var(--text-muted);}.seg.svelte-7gk24t button.on:where(.svelte-7gk24t) {background:var(--accent-soft);color:var(--accent);}.btn.svelte-7gk24t {display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border-strong);}.btn.svelte-7gk24t:hover:not(:disabled):not(.primary) {background:var(--bg-hover);}.btn.svelte-7gk24t:disabled {opacity:.45;cursor:default;}.btn.danger.svelte-7gk24t {color:var(--red);}.edit.svelte-7gk24t {display:grid;grid-template-columns:1fr 2fr;gap:8px;margin:0 0 14px;padding:12px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--bg-alt);}.edit.svelte-7gk24t label:where(.svelte-7gk24t) {grid-column:1 / -1;display:flex;flex-direction:column;gap:3px;color:var(--text-muted);font-size:calc(12px * var(--ui-scale, 1));}.edit.svelte-7gk24t label.half:where(.svelte-7gk24t) {grid-column:auto;}.edit.svelte-7gk24t .actions:where(.svelte-7gk24t) {grid-column:1 / -1;}.edit.svelte-7gk24t textarea:where(.svelte-7gk24t) {font:inherit;font-size:calc(13px * var(--ui-scale, 1));color:var(--text);background:var(--bg-elev);border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:5px 9px;resize:vertical;}.hint.svelte-7gk24t {color:var(--text-faint);font-weight:400;}.body.svelte-7gk24t {flex:1;min-height:0;display:grid;grid-template-columns:210px minmax(300px, 1.15fr) minmax(280px, 1fr);}.body.bare.svelte-7gk24t {grid-template-columns:minmax(300px, 1.4fr) minmax(280px, 1fr);}.list.empty-list.svelte-7gk24t {grid-column:span 2;} /* nothing to list: its words get the detail's column too */.detail.none.svelte-7gk24t {display:grid;place-content:center;text-align:center;color:var(--text-faint);}.side.svelte-7gk24t {overflow:auto;border-right:1px solid var(--border);padding:8px 6px;background:var(--bg-alt);display:flex;flex-direction:column;gap:1px;}.side.svelte-7gk24t h4:where(.svelte-7gk24t), .side.svelte-7gk24t .h4:where(.svelte-7gk24t) {display:flex;align-items:center;gap:4px;margin:12px 8px 4px;padding:0;font-size:calc(10.5px * var(--ui-scale, 1));font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);text-align:left;}.side.svelte-7gk24t .h4:where(.svelte-7gk24t):hover {color:var(--text);}.item.svelte-7gk24t {display:flex;align-items:center;gap:7px;width:100%;padding:4px 8px;border-radius:var(--radius-sm);color:var(--text);text-align:left;font-size:calc(12.5px * var(--ui-scale, 1));}.item.svelte-7gk24t:hover {background:var(--bg-hover);}.item.on.svelte-7gk24t {background:var(--accent-soft);color:var(--heading);box-shadow:inset 2px 0 0 var(--accent);}.item.drop.svelte-7gk24t {outline:2px dashed var(--accent);outline-offset:-2px;background:var(--accent-soft);}.item.svelte-7gk24t .n:where(.svelte-7gk24t) {flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.c.svelte-7gk24t {color:var(--text-faint);font-size:.85em;font-variant-numeric:tabular-nums;}.hash.svelte-7gk24t {color:var(--text-faint);width:14px;text-align:center;}.tagitem.svelte-7gk24t {color:var(--text-muted);}.tag.coll.svelte-7gk24t {display:inline-flex;gap:4px;align-items:center;color:var(--text);}.list.svelte-7gk24t {overflow:hidden auto; /* the grid wraps: a horizontal offset only ever hid the first column */border-right:1px solid var(--border);padding:6px;position:relative;user-select:none;-webkit-user-select:none;}.list.svelte-7gk24t .marquee {position:absolute;z-index:2;pointer-events:none;border:1px solid var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent);border-radius:2px;}.tree-row.svelte-7gk24t {display:flex;align-items:center;min-width:0;}.tree-row.svelte-7gk24t .item:where(.svelte-7gk24t) {flex:1;min-width:0;}.twisty.svelte-7gk24t {flex:none;width:16px;height:22px;display:grid;place-items:center;color:var(--text-faint);padding:0;}.twisty.svelte-7gk24t:hover {color:var(--text);}.picked.svelte-7gk24t {margin:8px 0 12px;padding-left:18px;font-size:.9em;color:var(--text-muted);}.picked.svelte-7gk24t li:where(.svelte-7gk24t) {overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.list.covers.svelte-7gk24t {display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:16px 14px;align-content:start;padding:14px;}.sr-only.svelte-7gk24t {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;}.list.table-mode.svelte-7gk24t {padding:0;overflow:auto;}.zot-table.svelte-7gk24t {width:100%;border-collapse:collapse;table-layout:fixed;font-size:calc(12.5px * var(--ui-scale, 1));}.zot-table.svelte-7gk24t thead:where(.svelte-7gk24t) th:where(.svelte-7gk24t) {position:sticky;top:0;z-index:1;background:var(--bg-alt);border-bottom:1px solid var(--border-strong);padding:0;text-align:left;font-weight:600;color:var(--text-muted);}.th-btn.svelte-7gk24t {width:100%;display:flex;align-items:center;gap:4px;padding:7px 8px;text-align:left;font:inherit;font-size:calc(11.5px * var(--ui-scale, 1));color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.th-btn.svelte-7gk24t:hover {background:var(--bg-hover);color:var(--text);}.sort-ind.svelte-7gk24t {color:var(--accent);flex:none;}.col-title.svelte-7gk24t {width:28%;}.col-author.svelte-7gk24t {width:17%;}.col-subtitle.svelte-7gk24t {width:24%;}.col-year.svelte-7gk24t {width:56px;}.col-venue.svelte-7gk24t {width:16%;}.col-publisher.svelte-7gk24t {width:14%;}.col-citekey.svelte-7gk24t {width:12%;font-family:var(--font-mono);}.col-kind.svelte-7gk24t, .col-type.svelte-7gk24t {width:10%;}.col-added.svelte-7gk24t {width:88px;}.col-pdf.svelte-7gk24t {width:54px;}.trow.svelte-7gk24t {cursor:pointer;}.trow.svelte-7gk24t td:where(.svelte-7gk24t) {padding:6px 8px;border-bottom:1px solid var(--border);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);vertical-align:middle;}.trow.svelte-7gk24t:hover td:where(.svelte-7gk24t) {background:var(--bg-hover);}.trow.sel.svelte-7gk24t td:where(.svelte-7gk24t) {background:var(--accent-soft);}.trow.sel.svelte-7gk24t td:where(.svelte-7gk24t):first-child {box-shadow:inset 2px 0 0 var(--accent);}.row-focus.svelte-7gk24t {display:block;width:100%;text-align:left;padding:0;font:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.row-focus.svelte-7gk24t .t:where(.svelte-7gk24t) {display:block;}.c-year.svelte-7gk24t, .c-added.svelte-7gk24t {font-variant-numeric:tabular-nums;}.c-citekey.svelte-7gk24t {font-family:var(--font-mono);font-size:calc(11.5px * var(--ui-scale, 1));}.c-pdf.svelte-7gk24t {text-align:center;}\n  /* a service's things, apart from the vault's: a band across the list with the way into the service's own app */.from-head.svelte-7gk24t {grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin:14px 0 2px;padding:8px 10px;border-radius:var(--radius-sm);background:var(--bg-alt);border:1px solid var(--border);color:var(--text-muted);font-size:calc(12px * var(--ui-scale, 1));}.from-head.svelte-7gk24t:first-child {margin-top:0;}.from-head.svelte-7gk24t .fh:where(.svelte-7gk24t) {font-weight:600;letter-spacing:.02em;color:var(--heading);}.from-head.svelte-7gk24t .fc:where(.svelte-7gk24t) {color:var(--text-faint);font-variant-numeric:tabular-nums;}.home.svelte-7gk24t {display:inline-flex;align-items:center;gap:6px;}.from-home.svelte-7gk24t {margin-left:auto;display:inline-flex;align-items:center;gap:5px;}.mine-none.svelte-7gk24t {grid-column:1 / -1;margin:4px 2px 0;color:var(--text-muted);}.row.svelte-7gk24t {display:grid;grid-template-columns:minmax(0, 1fr) auto;gap:2px 10px;width:100%;text-align:left;padding:8px 10px;border-radius:var(--radius-sm);}.row.svelte-7gk24t:hover {background:var(--bg-hover);}.row.sel.svelte-7gk24t {background:var(--accent-soft);box-shadow:inset 2px 0 0 var(--accent);}.card.svelte-7gk24t {display:flex;flex-direction:column;gap:4px;text-align:left;padding:4px;border-radius:var(--radius-sm);min-width:0;}\n  /* a library of thousands: items out of view are not laid out or painted (still in the page, for the marquee and keys) */.row.svelte-7gk24t {content-visibility:auto;contain-intrinsic-size:auto 52px;}\n  /* never a card: its height (a cover's 2:3 at the column's width, then two lines) is not one number, and WebKit kept\n     the guessed one for cards laid out again after the pane came back (titles drawn over the covers); covers already\n     load only near the view (LibraryCover) */.card.svelte-7gk24t:hover {background:var(--bg-hover);}.card.sel.svelte-7gk24t {background:var(--accent-soft);box-shadow:0 0 0 2px var(--accent);}.card.svelte-7gk24t .t:where(.svelte-7gk24t) {font-size:.92em;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;}.card.svelte-7gk24t .m:where(.svelte-7gk24t) {font-size:.8em;}.t.svelte-7gk24t {grid-column:1;color:var(--heading);font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.m.svelte-7gk24t {grid-column:1;color:var(--text-muted);font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\n  /* how far along: a thin bar, the done part in the accent */.bar.svelte-7gk24t {display:block;height:3px;border-radius:2px;background:linear-gradient(to right, var(--accent) calc(var(--p) * 100%), var(--border) 0);}.row.svelte-7gk24t .bar:where(.svelte-7gk24t) {grid-column:1 / -1;margin-top:3px;}.continue.svelte-7gk24t {flex:none;padding:8px 16px 10px;border-bottom:1px solid var(--border);}.continue.svelte-7gk24t h4:where(.svelte-7gk24t) {margin:0 0 6px;font-size:calc(10.5px * var(--ui-scale, 1));font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);}.strip.svelte-7gk24t {display:flex;gap:12px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px;}.go.svelte-7gk24t {flex:none;width:104px;display:flex;flex-direction:column;gap:4px;padding:3px;border-radius:var(--radius-sm);text-align:left;}.go.svelte-7gk24t:hover {background:var(--bg-hover);}.go.svelte-7gk24t .t:where(.svelte-7gk24t) {font-size:.82em;font-weight:500;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;}.narrow.svelte-7gk24t .continue:where(.svelte-7gk24t) {padding:6px 12px 8px;}.flags.svelte-7gk24t {grid-column:2;grid-row:1 / span 2;display:flex;gap:4px;align-items:center;}.flag.svelte-7gk24t {font-size:calc(11px * var(--ui-scale, 1));padding:1px 6px;border-radius:999px;background:var(--bg-hover);color:var(--text-muted);}.flag.red.svelte-7gk24t {color:var(--red);background:color-mix(in srgb, var(--red) 14%, transparent);}.flag.green.svelte-7gk24t {color:var(--green);background:color-mix(in srgb, var(--green) 14%, transparent);}.empty-state.svelte-7gk24t {display:flex;flex-direction:column;align-items:flex-start;gap:10px;}.empty-state.svelte-7gk24t p:where(.svelte-7gk24t) {margin:0;}.empty-actions.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:8px;}\n  /* a column; the linked mentions follow the item (at the bottom of a short card they stood apart, the column blank) */.detail.svelte-7gk24t {overflow:auto;padding:18px 22px 40px;display:flex;flex-direction:column;container-type:inline-size;}.detail.svelte-7gk24t > * {flex-shrink:0;}.facts.svelte-7gk24t {display:grid;gap:14px;margin:8px 0 4px;}\n  /* the picture a fixed, modest width: the fields get the rest (beside a 42 % picture they broke letter by letter) */.facts.pic.svelte-7gk24t {grid-template-columns:120px minmax(0, 1fr);align-items:start;}.facts-pic.svelte-7gk24t .cover.big {width:120px;}.facts-pic.svelte-7gk24t .cover.big {max-height:240px;margin:0;}.facts.svelte-7gk24t dl:where(.svelte-7gk24t) {margin:0;}.narrow.svelte-7gk24t .facts.pic:where(.svelte-7gk24t) {grid-template-columns:96px minmax(0, 1fr);}\n  /* a narrow panel (the usual ~300 px column): the picture on its own line, the fields the panel's whole width —\n     beside it the values broke inside words */\n  @container (max-width: 460px) {.facts.pic.svelte-7gk24t {grid-template-columns:minmax(0, 1fr);}.facts-pic.svelte-7gk24t .cover.big {width:auto;max-width:140px;max-height:190px;}\n  }\n  /* the mentions follow the item, open (an item's panel is where they matter), never pinned under an empty column */.links-bar.svelte-7gk24t {margin:22px -22px 0;padding-top:4px;display:flex;flex-direction:column;}.abstract.own.svelte-7gk24t {white-space:pre-line;}.more-notes.svelte-7gk24t {align-self:flex-start;margin-top:4px;}.kind.svelte-7gk24t {text-transform:uppercase;letter-spacing:.07em;font-size:calc(11px * var(--ui-scale, 1));color:var(--text-faint);}h2.svelte-7gk24t {margin:4px 0 6px;font-size:calc(19px * var(--ui-scale, 1));color:var(--heading);line-height:1.3;}.authors.svelte-7gk24t {margin:0;color:var(--text);}.venue.svelte-7gk24t {margin:2px 0 0;color:var(--text-muted);font-style:italic;}dl.svelte-7gk24t {display:grid;grid-template-columns:max-content minmax(0, 1fr);gap:3px 12px;font-size:.9em;margin:10px 0;}dt.svelte-7gk24t {color:var(--text-faint);}dd.svelte-7gk24t {margin:0;overflow-wrap:anywhere;}.actions.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 8px;}.choice.svelte-7gk24t {display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 10px;}.choice.svelte-7gk24t span:where(.svelte-7gk24t) {color:var(--text-faint);font-size:.85em;margin-right:2px;}.links.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:14px;margin:6px 0;}.links.svelte-7gk24t a:where(.svelte-7gk24t) {display:inline-flex;gap:5px;align-items:center;color:var(--link, var(--accent));text-decoration:none;font-size:.92em;}.links.svelte-7gk24t a:where(.svelte-7gk24t):hover {text-decoration:underline;}.tags.svelte-7gk24t {display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}.tag.svelte-7gk24t {font-size:calc(11.5px * var(--ui-scale, 1));padding:2px 9px;border-radius:999px;border:1px solid var(--border-strong);color:var(--text-muted);}.tag.svelte-7gk24t:hover {color:var(--text);border-color:var(--accent);}h3.svelte-7gk24t {margin:18px 0 6px;font-size:calc(11px * var(--ui-scale, 1));text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);}.abstract.svelte-7gk24t {margin:0;line-height:1.6;color:var(--text);}.pad.svelte-7gk24t {padding:12px 16px;}\n  /* the covers are a grid: the \"nothing here\" line spans all its columns (on a phone it sat in one, a word a line) */.list.svelte-7gk24t .none:where(.svelte-7gk24t) {grid-column:1 / -1;} /* only the list's: the detail's empty column must stay in its own column */\n\n  /* narrow: one column; groups as a row of chips; the card as a sheet over the list */.narrow.svelte-7gk24t header:where(.svelte-7gk24t) {padding:10px 12px;gap:8px;}.narrow.svelte-7gk24t .search:where(.svelte-7gk24t) {flex:1 1 100%;min-width:0;order:1;}.narrow.svelte-7gk24t .add:where(.svelte-7gk24t) {flex:1 1 100%;order:2;}.narrow.svelte-7gk24t .add:where(.svelte-7gk24t) input:where(.svelte-7gk24t) {flex:1;width:auto;min-width:0;}.narrow.svelte-7gk24t .types:where(.svelte-7gk24t) {padding:0 12px 8px;flex-wrap:nowrap;overflow-x:auto;}.narrow.svelte-7gk24t .body:where(.svelte-7gk24t), .narrow.svelte-7gk24t .body.bare:where(.svelte-7gk24t) {display:flex;flex-direction:column;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) {flex:none;flex-direction:row;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--border);padding:6px 12px;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) h4:where(.svelte-7gk24t), .narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .h4:where(.svelte-7gk24t) {margin:0 2px 0 6px;flex:none;}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .item:where(.svelte-7gk24t) {width:auto;flex:none;max-width:70vw;padding:5px 10px;border-radius:999px;border:1px solid var(--border);}.narrow.svelte-7gk24t .side:where(.svelte-7gk24t) .item.on:where(.svelte-7gk24t) {box-shadow:none;border-color:color-mix(in srgb, var(--accent) 45%, transparent);}.narrow.svelte-7gk24t .list:where(.svelte-7gk24t) {flex:1;border-right:0;}.narrow.svelte-7gk24t .zot-table:where(.svelte-7gk24t) {min-width:640px;}.narrow.svelte-7gk24t .list.covers:where(.svelte-7gk24t) {grid-template-columns:repeat(auto-fill, minmax(104px, 1fr));gap:12px 10px;padding:10px 12px;}.scrim.svelte-7gk24t {position:absolute;inset:0;z-index:6;background:var(--scrim);border:0;padding:0;cursor:default;}.narrow.svelte-7gk24t .detail:where(.svelte-7gk24t) {position:absolute;left:0;right:0;bottom:0;z-index:7;max-height:80%;padding:18px 16px calc(24px + env(safe-area-inset-bottom, 0px));background:var(--bg-elev);border-top:1px solid var(--border-strong);border-radius:14px 14px 0 0;box-shadow:var(--shadow-pop);}.narrow.svelte-7gk24t .detail:where(.svelte-7gk24t) .cover.big {max-height:180px;}\n  /* stays at the sheet's top right while its card scrolls */.close.svelte-7gk24t {position:sticky;top:0;float:right;z-index:1;margin:-8px -6px 0 8px;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;background:var(--bg-hover);}"
};
function rs(e, t) {
	Ge(t, !0), ii(e, ns);
	let n = (e, t = d) => {
		var n = za();
		let r;
		var i = L(n), a = (e) => {
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
		var o = z(i);
		O(n), B(() => {
			r = Q(n, 1, "btn svelte-7gk24t", null, r, {
				primary: t().primary,
				danger: t().danger
			}), n.disabled = t().disabled, $(n, "title", t().title), Y(o, ` ${t().label ?? ""}`);
		}), K("click", n, () => void Ee(t())), J(e, n);
	}, r = /* @__PURE__ */ M(() => t.source), i = (e, n, r = "info", i) => t.kandinsky.toast(e, n, r, { timeout: i }), a = (e) => t.kandinsky.richTitle(e), o = /* @__PURE__ */ P(I(G(() => ta.get(t.source.id) ?? []))), s = /* @__PURE__ */ P(""), c = /* @__PURE__ */ P(I(G(() => na.get(t.source.id)?.q ?? ""))), l = G(() => na.get(t.source.id)), u = /* @__PURE__ */ P(I(l?.scope ?? { kind: "all" })), f = /* @__PURE__ */ P(I(l?.tab ?? null)), p = /* @__PURE__ */ P(I(!!l?.tagsOpen)), h = /* @__PURE__ */ P(I(G(() => na.get(t.source.id)?.selId ?? null))), g = /* @__PURE__ */ P(I(G(() => na.get(t.source.id)?.sortId ?? t.source.sorts[0]?.id ?? ""))), _ = /* @__PURE__ */ P(I(G(() => na.get(t.source.id)?.sortDesc ?? null))), v = /* @__PURE__ */ P(""), y = /* @__PURE__ */ P(I(G(() => na.get(t.source.id)?.layout ?? t.source.layouts[0]))), ee = /* @__PURE__ */ P(I([])), b, te = [
		{
			id: "title",
			label: "Title"
		},
		{
			id: "subtitle",
			label: "Subtitle"
		},
		{
			id: "year",
			label: "Year"
		},
		{
			id: "type",
			label: "Type"
		},
		{
			id: "added",
			label: "Added"
		}
	], ne = /* @__PURE__ */ M(() => W(r).tableColumns?.length ? W(r).tableColumns : te);
	function re(e, t) {
		let n = e, r = n.columns, i = t.key ?? t.id;
		switch (i) {
			case "title": return n.title;
			case "creators":
			case "author": return r?.creators ?? n.sub ?? "";
			case "subtitle": return r?.subtitle ?? n.sub ?? "";
			case "year": return r?.year ?? "";
			case "venue": return r?.venue ?? "";
			case "publisher": return r?.publisher ?? "";
			case "citekey": return r?.citekey ?? n.id;
			case "kind":
			case "type": return r?.kind ?? r?.type ?? "";
			case "added": return r?.added ?? "";
			default: {
				let e = r?.[i];
				return typeof e == "string" ? e : "";
			}
		}
	}
	function ie(e) {
		return e.columns?.hasPdf === void 0 ? !e.flags?.some((e) => e.label === "no PDF") && !!e.flags?.some((e) => e.label === "PDF") : e.columns.hasPdf;
	}
	async function ae() {
		try {
			let e = new Map(W(o).map((e) => [e.id, e])), n = await t.source.load();
			F(o, (t.source.from ? n : n.filter((e) => !e.from)).map((t) => {
				let n = e.get(t.id);
				return n && JSON.stringify(n) === JSON.stringify(t) ? n : t;
			}), !0), ta.set(t.source.id, W(o)), F(s, "");
		} catch (e) {
			F(s, Zi(e), !0);
		}
	}
	let oe = /* @__PURE__ */ M(() => sa(W(o), (e) => e.groups, t.source.groupOrder)), se = /* @__PURE__ */ M(() => W(oe).some(([e]) => e.includes(ia))), ce = /* @__PURE__ */ P(I([])), x = /* @__PURE__ */ P(I([])), le = /* @__PURE__ */ M(() => new Set([...W(ce), ...W(oe).map(([e]) => e.split(ia)[0])].filter((e) => !W(x).includes(e)))), ue = /* @__PURE__ */ M(() => W(se) ? oa(W(oe), W(le)) : []);
	function de(e) {
		W(le).has(e) ? (F(ce, W(ce).filter((t) => t !== e), !0), F(x, [...W(x), e], !0)) : (F(x, W(x).filter((t) => t !== e), !0), F(ce, [...W(ce), e], !0));
	}
	let fe = /* @__PURE__ */ M(() => sa(W(o), (e) => e.tags)), pe = /* @__PURE__ */ M(() => {
		let e = W(o);
		return (typeof t.source.tabs == "function" ? t.source.tabs() : t.source.tabs ?? []).map((t) => ({
			...t,
			n: e.filter((e) => e.tab === t.id).length
		})).filter((e) => e.n || e.always);
	}), me = (e, t) => W(u).kind === e && (e === "all" || W(u).name === t), he = (e) => (!W(f) || e.tab === W(f)) && (W(u).kind === "all" || (W(u).kind === "group" ? aa(e.groups, W(u).name) : (e.tags ?? []).includes(W(u).name))), ge = /* @__PURE__ */ M(() => W(o).filter((e) => he(e) && ra(e, W(c)))), _e = /* @__PURE__ */ M(() => t.source.sorts.find((e) => e.id === W(g))), ve = /* @__PURE__ */ M(() => W(_) ?? !!W(_e)?.desc), S = (e) => e ? e.from ?? t.source.from ?? "" : "", C = /* @__PURE__ */ M(() => {
		let e = $i(W(ge), {
			id: W(g),
			desc: W(ve)
		}), t = [...new Set(e.map(S).filter(Boolean))];
		return [...e.filter((e) => !S(e)), ...t.flatMap((t) => e.filter((e) => S(e) === t))];
	}), ye = /* @__PURE__ */ M(() => W(o).filter((e) => !S(e)).length), be = (e) => t.source.homes?.find((t) => t.from === e), w = /* @__PURE__ */ M(() => W(C).find((e) => e.id === W(h)) ?? W(C)[0] ?? null);
	function xe(e) {
		let n;
		W(g) === e ? n = !W(ve) : (F(g, e, !0), n = t.source.sorts.find((t) => t.id === e)?.desc ?? (e === "year" || e === "added" || e === "pdf")), F(_, n, !0);
		let r = W(ne).find((t) => t.id === e)?.label ?? e;
		F(v, `Sorted by ${r}, ${n ? "descending" : "ascending"}`);
	}
	let Se = /* @__PURE__ */ M(() => W(c) || W(u).kind !== "all" ? [] : ea(W(o).filter((e) => (!W(f) || e.tab === W(f)) && (!W(ye) || !S(e))), 8));
	function Ce(e) {
		t.source.open ? t.source.open(e) : (F(h, e.id, !0), F(k, [e.id], !0));
	}
	let we = /* @__PURE__ */ P(1e3), T = /* @__PURE__ */ M(() => W(we) < 700), Te = /* @__PURE__ */ M(() => W(T) ? W(h) !== null && W(w)?.id === W(h) ? W(w) : null : W(w)), E = /* @__PURE__ */ P(null);
	yn(() => {
		let e = W(w);
		if (!e) {
			F(E, null);
			return;
		}
		let n = G(() => t.source.detail(e));
		if (!(n instanceof Promise)) {
			F(E, n, !0);
			return;
		}
		let r = !0;
		return n.then((e) => {
			r && F(E, e, !0);
		}, (e) => {
			r && F(s, Zi(e), !0);
		}), () => {
			r = !1;
		};
	});
	let D = /* @__PURE__ */ P(null);
	async function Ee(e) {
		if ("edit" in e) {
			F(D, {
				def: e.edit,
				values: Object.fromEntries(e.edit.fields.map((e) => [e.key, e.value]))
			}, !0);
			return;
		}
		"confirm" in e && !await t.kandinsky.confirm(e.confirm.title, {
			hint: e.confirm.hint,
			ok: e.confirm.button,
			danger: !0
		}) || await Oe(e.run);
	}
	async function Oe(e) {
		let t;
		try {
			t = await e();
		} catch (e) {
			i("It did not work", Zi(e), "error");
		}
		await ae(), typeof t == "string" && t && (F(h, t, !0), F(k, [t], !0));
	}
	async function ke() {
		if (W(D)) try {
			await W(D).def.save(W(D).values), F(D, null), await ae();
		} catch (e) {
			i("Could not save", Zi(e), "error");
		}
	}
	let Ae = /* @__PURE__ */ M(() => W(w)?.id);
	yn(() => {
		W(Ae), F(D, null);
	});
	let je = /* @__PURE__ */ P(!1), Me = /* @__PURE__ */ P("");
	async function Ne() {
		if (t.source.add && W(Me).trim() && !W(je)) {
			F(je, !0);
			try {
				let e = await t.source.add.run(W(Me).trim());
				await ae(), e && F(h, e, !0), F(Me, "");
			} catch (e) {
				i("Could not add it", Zi(e), "error", 9e3);
			} finally {
				F(je, !1);
			}
		}
	}
	let Pe = /* @__PURE__ */ P(!1);
	async function Fe(e) {
		if (e.preventDefault(), F(Pe, !1), !t.source.drop) return;
		let n = [...e.dataTransfer?.files ?? []].filter((e) => t.source.drop.accept.test(e.name));
		if (!n.length) {
			i("Nothing here can take these files");
			return;
		}
		let r = await t.source.drop.run(n, W(u).kind === "group" ? W(u).name : void 0);
		await ae(), r && (F(h, r, !0), F(k, [r], !0));
	}
	let Ie = "text/x-kandinsky-library", Le = /* @__PURE__ */ P(null);
	function Re(e, t) {
		let n = W(k).length > 1 && W(Ve).has(t.id) ? W(k) : [t.id];
		e.dataTransfer?.setData(Ie, JSON.stringify(n)), e.dataTransfer && (e.dataTransfer.effectAllowed = "move");
	}
	let ze = (e) => ({
		ondragover: (n) => {
			t.source.regroup && n.dataTransfer?.types.includes(Ie) && (n.preventDefault(), F(Le, e, !0));
		},
		ondragleave: () => {
			W(Le) === e && F(Le, null);
		},
		ondrop: async (n) => {
			let r = JSON.parse(n.dataTransfer?.getData(Ie) || "[]");
			if (t.source.regroup && r.length) {
				n.preventDefault(), n.stopPropagation(), F(Le, null);
				try {
					await t.source.regroup(W(o).filter((e) => r.includes(e.id)), e);
				} catch (e) {
					i("Not moved", Zi(e), "error");
				}
				await ae();
			}
		}
	}), k = /* @__PURE__ */ P(I([])), Be = null, Ve = /* @__PURE__ */ M(() => new Set(W(k))), He = /* @__PURE__ */ M(() => W(C).filter((e) => W(Ve).has(e.id))), Ue = (e) => W(k).length > 1 ? W(Ve).has(e.id) : W(Te)?.id === e.id;
	function A(e, n) {
		if (W(T) && t.source.open && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.target.closest(".wrap")) {
			t.source.open(n);
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			let e = W(k).length ? W(k) : W(w) ? [W(w).id] : [];
			F(k, e.includes(n.id) ? e.filter((e) => e !== n.id) : [...e, n.id], !0);
		} else if (e.shiftKey && Be) {
			let e = W(C).findIndex((e) => e.id === Be), t = W(C).indexOf(n);
			F(k, e < 0 ? [n.id] : W(C).slice(Math.min(e, t), Math.max(e, t) + 1).map((e) => e.id), !0);
		} else F(k, [n.id], !0);
		e.shiftKey || (Be = n.id), F(h, n.id, !0);
	}
	async function We(e, n) {
		if (typeof t.kandinsky.shell.popMenu != "function") return;
		if (W(k).length > 1 && W(Ve).has(n.id)) {
			t.kandinsky.shell.popMenu(e, W(Xe).map((e) => ({
				label: e.label,
				icon: e.icon,
				danger: e.danger,
				disabled: e.disabled,
				run: () => Ee(e)
			})));
			return;
		}
		F(k, [n.id], !0), Be = n.id, F(h, n.id, !0);
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
				run: () => Ee(e)
			});
			if (a.push(...i.actions.filter((e) => !e.more && !e.danger).map(e)), i.choice) {
				a.push(null);
				for (let e of i.choice.options) a.push({
					label: `${e.on ? "✓ " : ""}${e.label}`,
					detail: i.choice.label,
					disabled: e.on,
					run: () => Oe(e.run)
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
	function qe(e, n) {
		typeof t.kandinsky.shell.popMenu == "function" && t.kandinsky.shell.popMenu(e, n.map((e) => ({
			label: e.label,
			icon: e.icon,
			danger: e.danger,
			disabled: e.disabled,
			run: async () => {
				await Ee(e);
			}
		})));
	}
	let Je = [];
	function Ye(e, t) {
		t ? Je.length || (Je = W(k)) : Je = [], F(k, [.../* @__PURE__ */ new Set([...Je, ...e])], !0), e.length && F(h, e.at(-1), !0);
	}
	let Xe = /* @__PURE__ */ M(() => {
		let e = W(He);
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
	function Ze(e) {
		if (!W(C).length) return;
		let t = Math.max(0, Math.min(W(C).length - 1, (W(w) ? W(C).indexOf(W(w)) : -1) + e));
		F(h, W(C)[t].id, !0), F(k, [W(h)], !0), Be = W(h);
		let n = !!b?.contains(document.activeElement);
		requestAnimationFrame(() => {
			let e = b?.querySelector(".row.sel, .card.sel, .trow.sel");
			e?.scrollIntoView({ block: "nearest" }), n && (e?.querySelector(".row-focus") ?? e)?.focus();
		});
	}
	function Qe(e) {
		if (e.target.closest("input, select, textarea")) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
			e.preventDefault(), F(k, W(C).map((e) => e.id), !0);
			return;
		}
		if (e.key === "Escape" && W(k).length > 1) {
			e.preventDefault(), F(k, W(w) ? [W(w).id] : [], !0);
			return;
		}
		if (e.ctrlKey || ha(e) || e.altKey) return;
		let n = e.key;
		if (n === "ArrowDown" || n === "j" || W(y) === "covers" && n === "ArrowRight") Ze(1);
		else if (n === "ArrowUp" || n === "k" || W(y) === "covers" && n === "ArrowLeft") Ze(-1);
		else if (n === "Enter" && W(w) && t.source.open) t.source.open(W(w));
		else if (W(w) && t.source.keys?.[n]) t.source.keys[n](W(w));
		else return;
		e.preventDefault();
	}
	function $e(e, n) {
		return { destroy: t.kandinsky.mountBlock(e, {
			type: "backlinks",
			path: n,
			open: !0
		}) };
	}
	yn(() => {
		na.set(t.source.id, {
			scope: W(u),
			tab: W(f),
			q: W(c),
			selId: W(h),
			sortId: W(g),
			sortDesc: W(_),
			tagsOpen: W(p),
			layout: W(y),
			scroll: G(() => na.get(t.source.id)?.scroll ?? 0)
		});
	});
	let j = () => {
		let e = na.get(t.source.id);
		e && b && (e.scroll = b.scrollTop);
	};
	Ji(() => {
		let e = na.get(t.source.id)?.scroll ?? 0;
		e && b && requestAnimationFrame(() => {
			b.scrollTop = e;
		}), b?.addEventListener("scroll", j, { passive: !0 }), ae(), t.source.tools?.().then((e) => F(ee, e, !0), () => {});
		let n, r = t.source.watch?.(() => {
			clearTimeout(n), n = setTimeout(ae, 1200);
		});
		return () => {
			r?.(), clearTimeout(n), b?.removeEventListener("scroll", j);
		};
	});
	var et = ts();
	let tt;
	var nt = L(et), it = (e) => {
		var n = Ba(), r = R(n, !0);
		B(() => Y(r, t.source.drop.hint)), J(e, n);
	};
	X(nt, (e) => {
		W(Pe) && t.source.drop && e(it);
	});
	var at = z(nt, 2), ot = L(at), st = L(ot);
	Na(st, {
		get name() {
			return t.source.icon;
		},
		size: 18
	});
	var ct = z(st), lt = R(z(ct), !0);
	O(ot);
	var ut = z(ot, 2);
	Mi(ut);
	var dt = z(ut, 2), ft = (e) => {
		{
			let n = /* @__PURE__ */ M(() => t.source.sorts.map((e) => ({
				value: e.id,
				label: `Sort: ${e.label}`
			})));
			Ea(e, {
				get value() {
					return W(g);
				},
				label: "Sort by",
				onchange: (e) => {
					F(g, e, !0), F(_, null);
				},
				get options() {
					return W(n);
				}
			});
		}
	};
	X(dt, (e) => {
		t.source.sorts.length > 1 && e(ft);
	});
	var pt = z(dt, 2), mt = (e) => {
		var n = Ha();
		Z(n, 20, () => t.source.layouts, (e) => e, (e, t) => {
			var n = Va();
			let r;
			var i = R(n, !0);
			B(() => {
				$(n, "aria-checked", W(y) === t), r = Q(n, 1, "svelte-7gk24t", null, r, { on: W(y) === t }), Y(i, t === "covers" ? "Covers" : t === "table" ? "Table" : "List");
			}), K("click", n, () => F(y, t, !0)), J(e, n);
		}), O(n), J(e, n);
	};
	X(pt, (e) => {
		t.source.layouts.length > 1 && e(mt);
	});
	var ht = z(pt, 2);
	Z(ht, 17, () => t.source.homes ?? [], (e) => e.from, (e, t) => {
		var n = Ua(), r = L(n);
		Na(r, {
			name: "server",
			size: 14
		});
		var i = z(r);
		Na(z(i), {
			name: "external-link",
			size: 12
		}), O(n), B(() => {
			$(n, "title", `Open ${W(t).from ?? ""} in its own tab: what is there, yours or not`), Y(i, ` ${W(t).label ?? ""} `);
		}), K("click", n, () => void Oe(W(t).run)), J(e, n);
	});
	var gt = z(ht, 2), _t = (e) => {
		var n = Wa(), r = L(n);
		Mi(r);
		var i = z(r, 2), a = R(i, !0);
		O(n), B((e) => {
			$(r, "placeholder", t.source.add.placeholder), r.disabled = W(je), i.disabled = e, Y(a, W(je) ? t.source.add.busy : "Add");
		}, [() => !W(Me).trim() || W(je)]), Er("submit", n, (e) => {
			e.preventDefault(), Ne();
		}), Ri(r, () => W(Me), (e) => F(Me, e)), J(e, n);
	};
	X(gt, (e) => {
		t.source.add && e(_t);
	}), Z(z(gt, 2), 17, () => W(ee), (e) => e.label, (e, t) => {
		n(e, () => W(t));
	}), O(at);
	var vt = z(at, 2), yt = (e) => {
		var t = Ka(), n = L(t);
		let r;
		var i = R(z(L(n)), !0);
		O(n), Z(z(n, 2), 17, () => W(pe), (e) => e.id, (e, t) => {
			var n = Ga();
			let r;
			var i = L(n), a = R(z(i), !0);
			O(n), B(() => {
				r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: W(f) === W(t).id }), $(n, "aria-pressed", W(f) === W(t).id), Y(i, `${W(t).title ?? ""} `), Y(a, W(t).n);
			}), K("click", n, () => F(f, W(f) === W(t).id ? null : W(t).id, !0)), J(e, n);
		}), O(t), B(() => {
			r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: !W(f) }), Y(i, W(o).length);
		}), K("click", n, () => F(f, null)), J(e, t);
	};
	X(vt, (e) => {
		W(pe).length > 1 && e(yt);
	});
	var bt = z(vt, 2), xt = (e) => {
		var n = Ja(), r = L(n, !0), i = z(r), a = (e) => {
			var n = qa(), r = R(n, !0);
			B(() => Y(r, t.source.setup.label)), K("click", n, () => void Oe(async () => {
				await t.source.setup?.run(), await ae();
			})), J(e, n);
		};
		X(i, (e) => {
			t.source.setup && e(a);
		}), O(n), B(() => Y(r, t.source.setup ? t.source.empty : W(s))), J(e, n);
	};
	X(bt, (e) => {
		W(s) && e(xt);
	});
	var N = z(bt, 2), St = (e) => {
		var n = Za(), r = z(L(n), 2);
		Z(r, 21, () => W(Se), (e) => e.id, (e, n) => {
			var r = Xa(), i = L(r);
			Ra(i, {
				get kandinsky() {
					return t.kandinsky;
				},
				get cover() {
					return W(n).cover;
				},
				get title() {
					return W(n).title;
				}
			});
			var o = z(i, 2);
			ri(o, () => a(W(n).title), !0), O(o);
			var s = z(o, 2), c = (e) => {
				var t = Ya();
				let r;
				B((e) => {
					$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": W(n).progress });
				}, [() => Math.round(W(n).progress * 100)]), J(e, t);
			};
			X(s, (e) => {
				W(n).progress && e(c);
			}), O(r), B(() => $(r, "title", t.source.open ? `Open ${W(n).title}` : W(n).title)), K("click", r, () => Ce(W(n))), J(e, r);
		}), O(r), O(n), J(e, n);
	};
	X(N, (e) => {
		W(Se).length && e(St);
	});
	var Ct = z(N, 2);
	let wt;
	var Tt = L(Ct), Et = (e) => {
		var n = ao(), r = L(n);
		let i;
		var a = L(r);
		Na(a, {
			get name() {
				return t.source.icon;
			},
			size: 14
		});
		var s = z(a), c = R(s), l = R(z(s), !0);
		O(r);
		var d = z(r, 2), f = (e) => {
			var n = no(), r = sn(n), i = R(r, !0), a = z(r, 2), o = (e) => {
				var t = Fr();
				Z(sn(t), 17, () => W(ue), (e) => e.path, (e, t) => {
					var n = eo();
					let r;
					var i = L(n), a = (e) => {
						var n = Qa(), r = L(n);
						{
							let e = /* @__PURE__ */ M(() => W(le).has(W(t).path) ? "chevron-down" : "chevron");
							Na(r, {
								get name() {
									return W(e);
								},
								size: 12
							});
						}
						O(n), B((e, t) => {
							$(n, "aria-label", e), $(n, "aria-expanded", t);
						}, [() => W(le).has(W(t).path) ? `Close ${W(t).name}` : `Open ${W(t).name}`, () => W(le).has(W(t).path)]), K("click", n, () => de(W(t).path)), J(e, n);
					}, o = (e) => {
						J(e, $a());
					};
					X(i, (e) => {
						W(t).kids ? e(a) : e(o, -1);
					});
					var s = z(i, 2), c = () => F(u, {
						kind: "group",
						name: W(t).path
					}, !0), l = () => W(t).kids && de(W(t).path);
					Pi(s, (e, n) => ({
						class: "item",
						onclick: c,
						ondblclick: l,
						title: W(t).path,
						...e,
						[wi]: {
							on: n,
							drop: W(Le) === W(t).path
						}
					}), [() => ze(W(t).path), () => me("group", W(t).path)], void 0, void 0, "svelte-7gk24t");
					var d = L(s);
					{
						let e = /* @__PURE__ */ M(() => W(le).has(W(t).path) && W(t).kids ? "folder-open" : "folder");
						Na(d, {
							get name() {
								return W(e);
							},
							size: 14
						});
					}
					var f = z(d), p = R(f, !0), m = R(z(f), !0);
					O(s), O(n), B(() => {
						r = gi(n, "", r, { "padding-left": `${W(t).depth * 12}px` }), Y(p, W(t).name), Y(m, W(t).count);
					}), J(e, n);
				}), J(e, t);
			}, s = (e) => {
				var t = Fr();
				Z(sn(t), 17, () => W(oe), ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ M(() => m(W(t), 2));
					let r = () => W(n)[0], i = () => W(n)[1];
					var a = to(), o = () => F(u, {
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
							drop: W(Le) === r()
						}
					}), [() => ze(r()), () => me("group", r())], void 0, void 0, "svelte-7gk24t");
					var s = L(a);
					Na(s, {
						name: "folder",
						size: 14
					});
					var c = z(s), l = R(c, !0), d = R(z(c), !0);
					O(a), B(() => {
						Y(l, r()), Y(d, i());
					}), J(e, a);
				}), J(e, t);
			};
			X(a, (e) => {
				W(se) ? e(o) : e(s, -1);
			}), B(() => Y(i, t.source.groupsTitle ?? "Groups")), J(e, n);
		};
		X(d, (e) => {
			W(oe).length && e(f);
		});
		var h = z(d, 2), g = (e) => {
			var t = io(), n = sn(t), r = L(n);
			{
				let e = /* @__PURE__ */ M(() => W(p) ? "chevron-down" : "chevron");
				Na(r, {
					get name() {
						return W(e);
					},
					size: 12
				});
			}
			var i = R(z(r, 2), !0);
			O(n);
			var a = z(n, 2), o = (e) => {
				var t = Fr();
				Z(sn(t), 17, () => W(fe), ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ M(() => m(W(t), 2));
					let r = () => W(n)[0], i = () => W(n)[1];
					var a = Fr(), o = sn(a), s = (e) => {
						var t = ro();
						let n;
						var a = z(L(t)), o = R(a, !0), s = R(z(a), !0);
						O(t), B((e) => {
							n = Q(t, 1, "item tagitem svelte-7gk24t", null, n, { on: e }), $(t, "title", r()), Y(o, r()), Y(s, i());
						}, [() => me("tag", r())]), K("click", t, () => F(u, {
							kind: "tag",
							name: r()
						}, !0)), J(e, t);
					}, c = /* @__PURE__ */ M(() => W(p) || me("tag", r()));
					X(o, (e) => {
						W(c) && e(s);
					}), J(e, a);
				}), J(e, t);
			};
			X(a, (e) => {
				(W(p) || W(u).kind === "tag") && e(o);
			}), B(() => {
				$(n, "aria-expanded", W(p)), Y(i, W(fe).length);
			}), K("click", n, () => F(p, !W(p))), J(e, t);
		};
		X(h, (e) => {
			W(fe).length && e(g);
		}), O(n), B((e) => {
			$(n, "aria-label", t.source.groupsTitle ?? "Groups"), i = Q(r, 1, "item svelte-7gk24t", null, i, { on: e }), Y(c, `All ${t.source.noun ?? ""}`), Y(l, W(o).length);
		}, [() => me("all")]), K("click", r, () => F(u, { kind: "all" }, !0)), J(e, n);
	};
	X(Tt, (e) => {
		(W(oe).length || W(fe).length) && e(Et);
	});
	var Dt = z(Tt, 2);
	let Ot;
	var kt = L(Dt), At = (e) => {
		var n = ho(), r = sn(n), i = R(r, !0), o = z(r, 2), s = L(o), c = R(s, !0), l = z(s), u = L(l);
		Z(u, 21, () => W(ne), (e) => e.id, (e, t) => {
			var n = oo(), r = L(n), i = L(r), a = R(i, !0), o = R(z(i), !0);
			O(r), O(n), B(() => {
				Q(n, 1, `col-${W(t).id ?? ""}`, "svelte-7gk24t"), $(n, "aria-sort", W(g) === W(t).id ? W(ve) ? "descending" : "ascending" : void 0), Y(a, W(t).label), Y(o, W(g) === W(t).id ? W(ve) ? " ↓" : " ↑" : "");
			}), K("click", r, () => xe(W(t).id)), J(e, n);
		}), O(u), O(l);
		var d = z(l);
		Z(d, 21, () => W(C), (e) => e.id, (e, n) => {
			var r = mo();
			let i;
			Z(r, 21, () => W(ne), (e) => e.id, (e, r) => {
				var i = Fr(), o = sn(i), s = (e) => {
					var r = so(), i = L(r), o = L(i);
					ri(o, () => a(W(n).title), !0), O(o), O(i), O(r), B(() => $(r, "title", W(n).title)), K("click", i, (e) => {
						e.stopPropagation(), A(e, W(n));
					}), K("dblclick", i, (e) => {
						e.stopPropagation(), t.source.open?.(W(n));
					}), J(e, r);
				}, c = (e) => {
					var t = fo(), r = L(t), i = (e) => {
						J(e, co());
					}, a = /* @__PURE__ */ M(() => ie(W(n))), o = (e) => {
						J(e, lo());
					}, s = /* @__PURE__ */ M(() => W(n).flags?.some((e) => e.label === "no PDF")), c = (e) => {
						J(e, uo());
					};
					X(r, (e) => {
						W(a) ? e(i) : W(s) ? e(o, 1) : e(c, -1);
					}), O(t), J(e, t);
				}, l = (e) => {
					let t = /* @__PURE__ */ M(() => re(W(n), W(r)));
					var i = po(), a = R(i, !0);
					B(() => {
						Q(i, 1, `c-${W(r).id ?? ""}`, "svelte-7gk24t"), $(i, "title", W(t) || void 0), Y(a, W(t));
					}), J(e, i);
				};
				X(o, (e) => {
					W(r).id === "title" ? e(s) : W(r).id === "pdf" ? e(c, 1) : e(l, -1);
				}), J(e, i);
			}), O(r), B((e) => {
				i = Q(r, 1, "trow svelte-7gk24t", null, i, { sel: e }), $(r, "data-pick", W(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0);
			}, [() => Ue(W(n))]), Er("dragstart", r, (e) => Re(e, W(n))), K("click", r, (e) => A(e, W(n))), K("dblclick", r, () => t.source.open?.(W(n))), K("contextmenu", r, (e) => void We(e, W(n))), J(e, r);
		}), O(d), O(o), B(() => {
			Y(i, W(v)), Y(c, t.source.title);
		}), J(e, n);
	}, jt = (e) => {
		var i = Fr();
		Z(sn(i), 19, () => W(C), (e) => e.id, (e, n, r) => {
			var i = Co(), o = sn(i), s = (e) => {
				let t = /* @__PURE__ */ M(() => be(S(W(n))));
				var r = _o(), i = L(r);
				Na(i, {
					name: "server",
					size: 14
				});
				var a = z(i), o = R(a), s = z(a, 2), c = R(s, !0), l = z(s, 2), u = (e) => {
					var n = go(), r = L(n);
					Na(z(r), {
						name: "external-link",
						size: 12
					}), O(n), B(() => Y(r, `${W(t).label ?? ""} `)), K("click", n, () => void Oe(W(t).run)), J(e, n);
				};
				X(l, (e) => {
					W(t) && e(u);
				}), O(r), B((e, t) => {
					Y(o, `From ${e ?? ""}`), Y(c, t);
				}, [() => S(W(n)), () => W(C).filter((e) => S(e) === S(W(n))).length]), J(e, r);
			}, c = /* @__PURE__ */ M(() => S(W(n)) && S(W(n)) !== S(W(C)[W(r) - 1]));
			X(o, (e) => {
				W(c) && e(s);
			});
			var l = z(o, 2), u = (e) => {
				var r = yo();
				let i;
				var o = L(r);
				Ra(o, {
					get kandinsky() {
						return t.kandinsky;
					},
					get cover() {
						return W(n).cover;
					},
					get title() {
						return W(n).title;
					}
				});
				var s = z(o, 2), c = (e) => {
					var t = Ya();
					let r;
					B((e) => {
						$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": W(n).progress });
					}, [() => Math.round(W(n).progress * 100)]), J(e, t);
				};
				X(s, (e) => {
					W(n).progress && e(c);
				});
				var l = z(s, 2);
				ri(l, () => a(W(n).title), !0), O(l);
				var u = z(l, 2), d = (e) => {
					var t = vo(), r = R(t, !0);
					B(() => Y(r, W(n).sub)), J(e, t);
				};
				X(u, (e) => {
					W(n).sub && e(d);
				}), O(r), B((e) => {
					i = Q(r, 1, "card svelte-7gk24t", null, i, { sel: e }), $(r, "data-pick", W(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0), $(r, "title", W(n).sub);
				}, [() => Ue(W(n))]), Er("dragstart", r, (e) => Re(e, W(n))), K("click", r, (e) => A(e, W(n))), K("dblclick", r, () => t.source.open?.(W(n))), K("contextmenu", r, (e) => void We(e, W(n))), J(e, r);
			}, d = (e) => {
				var r = So();
				let i;
				var o = L(r);
				ri(o, () => a(W(n).title), !0), O(o);
				var s = z(o, 2), c = (e) => {
					var t = vo(), r = R(t, !0);
					B(() => Y(r, W(n).sub)), J(e, t);
				};
				X(s, (e) => {
					W(n).sub && e(c);
				});
				var l = z(s, 2), u = (e) => {
					var t = xo();
					Z(t, 21, () => W(n).flags, (e) => e.label, (e, t) => {
						var n = bo();
						let r;
						var i = R(n, !0);
						B(() => {
							r = Q(n, 1, "flag svelte-7gk24t", null, r, { red: W(t).tone === "red" }), Y(i, W(t).label);
						}), J(e, n);
					}), O(t), J(e, t);
				};
				X(l, (e) => {
					W(n).flags?.length && e(u);
				});
				var d = z(l, 2), f = (e) => {
					var t = Ya();
					let r;
					B((e) => {
						$(t, "aria-label", `${e ?? ""} %`), r = gi(t, "", r, { "--p": W(n).progress });
					}, [() => Math.round(W(n).progress * 100)]), J(e, t);
				};
				X(d, (e) => {
					W(n).progress && e(f);
				}), O(r), B((e) => {
					i = Q(r, 1, "row svelte-7gk24t", null, i, { sel: e }), $(r, "data-pick", W(n).id), $(r, "draggable", t.source.regroup ? "true" : void 0);
				}, [() => Ue(W(n))]), Er("dragstart", r, (e) => Re(e, W(n))), K("click", r, (e) => A(e, W(n))), K("dblclick", r, () => t.source.open?.(W(n))), K("contextmenu", r, (e) => void We(e, W(n))), J(e, r);
			};
			X(l, (e) => {
				W(y) === "covers" ? e(u) : e(d, -1);
			}), J(e, i);
		}, (e) => {
			var i = To(), a = L(i), s = R(a, !0), c = z(a, 2), l = (e) => {
				var i = wo(), a = L(i), o = (e) => {
					var n = qa(), r = R(n, !0);
					B(() => Y(r, t.source.setup.label)), K("click", n, () => void Oe(async () => {
						await t.source.setup?.run(), await ae();
					})), J(e, n);
				};
				X(a, (e) => {
					t.source.setup && e(o);
				}), Z(z(a, 2), 17, () => W(r).emptyActions ?? [], (e) => e.label, (e, t) => {
					n(e, () => W(t));
				}), O(i), J(e, i);
			};
			X(c, (e) => {
				!W(o).length && (t.source.setup || W(r).emptyActions?.length) && e(l);
			}), O(i), B((e) => Y(s, e), [() => W(o).length ? "Nothing matches." : t.source.homes?.length ? `Nothing of yours yet. What is on ${t.source.homes.map((e) => e.from).join(" or ")} is in its own tab (the button above); a thing comes here once you read it or write about it.` : t.source.empty]), J(e, i);
		}), J(e, i);
	};
	X(kt, (e) => {
		W(y) === "table" && W(C).length ? e(At) : e(jt, -1);
	}), O(Dt), Wi(Dt, (e) => b = e, () => b), ai(Dt, (e, t) => _a?.(e, t), () => ({ pick: Ye }));
	var Mt = z(Dt, 2), Nt = (e) => {
		var r = Oo(), i = L(r), o = R(i), s = z(i, 2), c = L(s);
		Z(c, 17, () => W(He).slice(0, 12), (e) => e.id, (e, t) => {
			var n = Eo();
			ri(n, () => a(W(t).title), !0), O(n), J(e, n);
		});
		var l = z(c), u = (e) => {
			var t = Do(), n = R(t);
			B(() => Y(n, `and ${W(He).length - 12} more`)), J(e, t);
		};
		X(l, (e) => {
			W(He).length > 12 && e(u);
		}), O(s);
		var d = z(s, 2), f = L(d);
		Z(f, 17, () => W(Xe), (e) => e.label, (e, t) => {
			n(e, () => W(t));
		});
		var p = z(f);
		O(d), O(r), B(() => Y(o, `${W(He).length ?? ""} ${t.source.noun ?? ""} picked`)), K("click", p, () => F(k, W(w) ? [W(w).id] : [], !0)), J(e, r);
	}, Pt = (e) => {
		var r = $o(), i = sn(r), o = (e) => {
			var t = ko();
			K("click", t, () => F(h, null)), J(e, t);
		};
		X(i, (e) => {
			W(T) && e(o);
		});
		var s = z(i, 2), c = L(s), l = (e) => {
			var t = Ao();
			Na(L(t), {
				name: "close",
				size: 16
			}), O(t), K("click", t, () => F(h, null)), J(e, t);
		};
		X(c, (e) => {
			W(T) && e(l);
		});
		var d = z(c, 2), f = (e) => {
			var t = Fo(), n = L(t);
			Z(n, 17, () => W(D).def.fields, (e) => e.key, (e, t) => {
				var n = Po();
				let r;
				var i = L(n, !0), a = z(i), o = (e) => {
					var n = jo(), r = R(n, !0);
					B(() => Y(r, W(t).hint)), J(e, n);
				};
				X(a, (e) => {
					W(t).hint && e(o);
				});
				var s = z(a, 2), c = (e) => {
					var n = Mo();
					rt(n), B(() => $(n, "rows", W(t).rows)), Ri(n, () => W(D).values[W(t).key], (e) => W(D).values[W(t).key] = e), J(e, n);
				}, l = (e) => {
					var n = No();
					Mi(n), Ri(n, () => W(D).values[W(t).key], (e) => W(D).values[W(t).key] = e), J(e, n);
				};
				X(s, (e) => {
					W(t).rows ? e(c) : e(l, -1);
				}), O(n), B(() => {
					r = Q(n, 1, "svelte-7gk24t", null, r, { half: W(t).half }), Y(i, W(t).label);
				}), J(e, n);
			});
			var r = z(n, 2), i = z(L(r));
			O(r), O(t), Er("submit", t, (e) => {
				e.preventDefault(), ke();
			}), K("keydown", t, (e) => {
				e.key === "Escape" && (e.stopPropagation(), F(D, null));
			}), K("click", i, () => F(D, null)), J(e, t);
		};
		X(d, (e) => {
			W(D) && e(f);
		});
		var p = z(d, 2), g = (e) => {
			var t = Io(), n = R(t, !0);
			B(() => Y(n, W(E).kind)), J(e, t);
		};
		X(p, (e) => {
			W(E).kind && e(g);
		});
		var _ = z(p, 2);
		ri(_, () => a(W(E).title), !0), O(_);
		var v = z(_, 2);
		Z(v, 17, () => W(E).lines ?? [], Jr, (e, t) => {
			var n = Lo(), r = R(n, !0);
			B(() => {
				Q(n, 1, li(W(t).muted ? "venue" : "authors"), "svelte-7gk24t"), Y(r, W(t).text);
			}), J(e, n);
		});
		var y = z(v, 2), ee = L(y);
		Z(ee, 17, () => W(E).actions.filter((e) => !e.more), (e) => e.label, (e, t) => {
			n(e, () => W(t));
		});
		var b = z(ee, 2), te = (e) => {
			let t = /* @__PURE__ */ M(() => W(E).actions.filter((e) => e.more));
			var n = Ro();
			Na(L(n), {
				name: "more",
				size: 14
			}), O(n), B((e) => $(n, "title", `More: ${e ?? ""}`), [() => W(t).map((e) => e.label).join(", ")]), K("click", n, (e) => qe(e, W(t))), J(e, n);
		}, ne = /* @__PURE__ */ M(() => W(E).actions.some((e) => e.more));
		X(b, (e) => {
			W(ne) && e(te);
		}), O(y);
		var re = z(y, 2), ie = (e) => {
			var n = Ho();
			let r;
			var i = L(n), a = (e) => {
				var n = zo();
				qr(L(n), () => W(w).id, (e) => {
					Ra(e, {
						get kandinsky() {
							return t.kandinsky;
						},
						get cover() {
							return W(w).cover;
						},
						get title() {
							return W(w).title;
						},
						big: !0
					});
				}), O(n), J(e, n);
			};
			X(i, (e) => {
				W(w).cover && e(a);
			});
			var o = z(i, 2), s = (e) => {
				var t = Vo();
				Z(t, 21, () => W(E).fields, ([e, t]) => e, (e, t) => {
					var n = /* @__PURE__ */ M(() => m(W(t), 2));
					let r = () => W(n)[0], i = () => W(n)[1];
					var a = Bo(), o = sn(a), s = R(o, !0), c = R(z(o), !0);
					B(() => {
						Y(s, r()), Y(c, i());
					}), J(e, a);
				}), O(t), J(e, t);
			};
			X(o, (e) => {
				W(E).fields?.length && e(s);
			}), O(n), B(() => r = Q(n, 1, "facts svelte-7gk24t", null, r, { pic: !!W(w).cover })), J(e, n);
		};
		X(re, (e) => {
			(W(w).cover || W(E).fields?.length) && e(ie);
		});
		var ae = z(re, 2), oe = (e) => {
			var t = Uo(), n = L(t), r = R(n, !0);
			Z(z(n, 2), 17, () => W(E).choice.options, (e) => e.label, (e, t) => {
				var n = Va();
				let r;
				var i = R(n, !0);
				B(() => {
					r = Q(n, 1, "chip svelte-7gk24t", null, r, { on: W(t).on }), $(n, "aria-checked", W(t).on), Y(i, W(t).label);
				}), K("click", n, () => void Oe(W(t).run)), J(e, n);
			}), O(t), B(() => {
				$(t, "aria-label", W(E).choice.label), Y(r, W(E).choice.label);
			}), J(e, t);
		};
		X(ae, (e) => {
			W(E).choice && e(oe);
		});
		var se = z(ae, 2), ce = (e) => {
			var t = Go();
			Z(t, 21, () => W(E).links, (e) => e.url, (e, t) => {
				var n = Wo(), r = L(n);
				Na(r, {
					name: "link",
					size: 13
				});
				var i = z(r);
				O(n), B(() => {
					$(n, "href", W(t).url), Y(i, ` ${W(t).label ?? ""}`);
				}), J(e, n);
			}), O(t), J(e, t);
		};
		X(se, (e) => {
			W(E).links?.length && e(ce);
		});
		var x = z(se, 2), le = (e) => {
			var t = Jo(), n = L(t);
			Z(n, 16, () => W(w).groups ?? [], (e) => e, (e, t) => {
				var n = Ko(), r = L(n);
				Na(r, {
					name: "folder",
					size: 12
				});
				var i = z(r, 1, !0);
				O(n), B(() => Y(i, t)), K("click", n, () => F(u, {
					kind: "group",
					name: t
				}, !0)), J(e, n);
			}), Z(z(n, 2), 16, () => W(w).tags ?? [], (e) => e, (e, t) => {
				var n = qo(), r = R(n);
				B(() => Y(r, `#${t ?? ""}`)), K("click", n, () => F(u, {
					kind: "tag",
					name: t
				}, !0)), J(e, n);
			}), O(t), J(e, t);
		};
		X(x, (e) => {
			(W(w).groups?.length || W(w).tags?.length) && e(le);
		});
		var ue = z(x, 2), de = (e) => {
			var t = Yo(), n = sn(t), r = R(n, !0), i = R(z(n), !0);
			B(() => {
				Y(r, W(E).body.title), Y(i, W(E).body.text);
			}), J(e, t);
		};
		X(ue, (e) => {
			W(E).body && e(de);
		});
		var fe = z(ue, 2), pe = (e) => {
			var t = Xo(), n = z(sn(t)), r = R(n, !0), i = z(n);
			B(() => Y(r, W(E).notes.text)), K("click", i, () => W(E)?.notes?.open()), J(e, t);
		};
		X(fe, (e) => {
			W(E).notes && e(pe);
		});
		var me = z(fe, 2), he = (e) => {
			var t = Qo();
			qr(L(t), () => W(w).note, (e) => {
				var t = Zo();
				ai(t, (e, t) => $e?.(e, t), () => W(w).note), J(e, t);
			}), O(t), J(e, t);
		};
		X(me, (e) => {
			W(w).note && e(he);
		}), O(s), J(e, r);
	}, Ft = (e) => {
		var n = es(), r = L(n), i = L(r);
		De(), O(r), O(n), B(() => Y(i, `Pick one of the ${t.source.noun ?? ""} to see it here.`)), J(e, n);
	};
	X(Mt, (e) => {
		W(He).length > 1 ? e(Nt) : W(Te) && W(E) ? e(Pt, 1) : !W(T) && W(o).length && e(Ft, 2);
	}), O(Ct), O(et), B(() => {
		tt = Q(et, 1, "library svelte-7gk24t", null, tt, {
			dragging: W(Pe),
			narrow: W(T)
		}), $(et, "aria-label", t.source.title), $(et, "data-source", t.source.id), Y(ct, ` ${t.source.title ?? ""} `), Y(lt, W(ge).length === W(o).length ? W(o).length : `${W(ge).length} / ${W(o).length}`), $(ut, "placeholder", t.source.search), wt = Q(Ct, 1, "body svelte-7gk24t", null, wt, { bare: !W(oe).length && !W(fe).length }), Ot = Q(Dt, 1, "list svelte-7gk24t", null, Ot, {
			covers: W(y) === "covers",
			"table-mode": W(y) === "table",
			"empty-list": !W(o).length
		});
	}), K("keydown", et, Qe), Er("dragover", et, (e) => {
		t.source.drop && e.dataTransfer?.types.includes("Files") && (e.preventDefault(), F(Pe, !0));
	}), Er("dragleave", et, (e) => {
		e.currentTarget === e.target && F(Pe, !1);
	}), Er("drop", et, Fe), Ri(ut, () => W(c), (e) => F(c, e)), Hi(et, "clientWidth", (e) => F(we, e)), J(e, et), Ke();
}
Dr([
	"click",
	"keydown",
	"dblclick",
	"contextmenu"
]);
//#endregion
//#region plugins/beta/catalog/ui/src/Libraries.svelte
var is = /* @__PURE__ */ q("<button role=\"tab\"><!> </button>"), as = /* @__PURE__ */ q("<span class=\"apart svelte-1hozhyt\" aria-hidden=\"true\"></span><span class=\"label svelte-1hozhyt\">On your servers</span> <!>", 1), os = /* @__PURE__ */ q("<div class=\"which svelte-1hozhyt\" role=\"tablist\" aria-label=\"Libraries\"><!> <!></div>"), ss = /* @__PURE__ */ q("<p class=\"none svelte-1hozhyt\">No library in this vault yet. Show a folder as a library from its menu in the file explorer (“Show as a library”), or add one in Settings → Libraries.</p>"), cs = /* @__PURE__ */ q("<p class=\"none svelte-1hozhyt\"> </p>"), ls = /* @__PURE__ */ q("<div class=\"libraries svelte-1hozhyt\"><!> <!></div>"), us = {
	hash: "svelte-1hozhyt",
	code: ".libraries.svelte-1hozhyt {display:flex;flex-direction:column;height:100%;min-height:0;}.which.svelte-1hozhyt {display:flex;gap:4px;padding:6px 10px 0;overflow-x:auto;flex:none;border-bottom:1px solid var(--border);}.which.svelte-1hozhyt button:where(.svelte-1hozhyt) {display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:none;background:none;color:var(--text-muted);border-bottom:2px solid transparent;white-space:nowrap;font:inherit;cursor:pointer;}.which.svelte-1hozhyt button:where(.svelte-1hozhyt):hover {color:var(--text);}.which.svelte-1hozhyt button.on:where(.svelte-1hozhyt) {color:var(--text);border-bottom-color:var(--accent);}.which.svelte-1hozhyt .apart:where(.svelte-1hozhyt) {flex:none;width:1px;margin:6px 6px 8px;background:var(--border-strong);}.which.svelte-1hozhyt .label:where(.svelte-1hozhyt) {flex:none;align-self:center;padding:0 4px 2px;color:var(--text-faint);font-size:calc(11px * var(--ui-scale, 1));text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}.libraries.svelte-1hozhyt > :last-child {flex:1;min-height:0;}.none.svelte-1hozhyt {padding:24px;color:var(--text-muted);}"
};
function ds(e, t) {
	Ge(t, !0), ii(e, us);
	let n = "kandinsky.libraries.last", r = /* @__PURE__ */ P(G(() => t.kandinsky.libraries.list())), i = /* @__PURE__ */ M(() => fa(W(r))), a = /* @__PURE__ */ M(() => W(i).filter((e) => !e.from)), o = /* @__PURE__ */ M(() => W(i).filter((e) => e.from)), s = /* @__PURE__ */ P(I(G(() => t.kandinsky.anchor) || Yi(n, "")));
	Ji(() => {
		let e = t.kandinsky.libraries.onChange((e) => F(r, e)), n = t.kandinsky.pane?.onAnchor((e) => F(s, e, !0));
		return () => {
			e(), n?.();
		};
	});
	let c = /* @__PURE__ */ M(() => W(i).find((e) => e.id === W(s) || e.members?.includes(W(s))) ?? W(i)[0]), l = /* @__PURE__ */ P(null), u = /* @__PURE__ */ P("");
	yn(() => {
		let e = W(c);
		if (F(l, null), F(u, ""), !e) return;
		Xi(n, e.id);
		let t = !0;
		return Promise.resolve(e.source()).then((e) => {
			t && F(l, e, !0);
		}, (n) => {
			t && F(u, `${e.title}: ${Zi(n)}`);
		}), () => {
			t = !1;
		};
	});
	var f = ls();
	{
		let e = (e, t = d) => {
			var n = is();
			let r;
			var i = L(n);
			Na(i, {
				get name() {
					return t().icon;
				},
				size: 14
			});
			var a = z(i, 1, !0);
			O(n), B(() => {
				$(n, "aria-selected", t() === W(c)), r = Q(n, 1, "svelte-1hozhyt", null, r, { on: t() === W(c) }), Y(a, t().title);
			}), K("click", n, () => F(s, t().id, !0)), J(e, n);
		};
		var p = L(f), m = (t) => {
			var n = os(), r = L(n);
			Z(r, 17, () => W(a), (e) => e.id, (t, n) => {
				e(t, () => W(n));
			});
			var i = z(r, 2), s = (t) => {
				var n = as();
				Z(z(sn(n), 3), 17, () => W(o), (e) => e.id, (t, n) => {
					e(t, () => W(n));
				}), J(t, n);
			};
			X(i, (e) => {
				W(o).length && e(s);
			}), O(n), J(t, n);
		};
		X(p, (e) => {
			W(i).length > 1 && e(m);
		});
		var h = z(p, 2), g = (e) => {
			J(e, ss());
		}, _ = (e) => {
			var t = cs(), n = R(t, !0);
			B(() => Y(n, W(u))), J(e, t);
		}, v = (e) => {
			var n = Fr();
			qr(sn(n), () => W(l), (e) => {
				rs(e, {
					get kandinsky() {
						return t.kandinsky;
					},
					get source() {
						return W(l);
					}
				});
			}), J(e, n);
		};
		X(h, (e) => {
			W(c) ? W(u) ? e(_, 1) : W(l) && e(v, 2) : e(g);
		}), O(f);
	}
	J(e, f), Ke();
}
Dr(["click"]);
//#endregion
//#region plugins/beta/catalog/ui/src/view.ts
function fs(e, t) {
	e.style.height = "100%";
	let n = Br(ds, {
		target: e,
		props: { kandinsky: t }
	});
	return () => void Wr(n);
}
function ps(e, t, n) {
	e.style.height = "100%";
	let r = Br(rs, {
		target: e,
		props: {
			kandinsky: n,
			source: t
		}
	});
	return () => void Wr(r);
}
//#endregion
export { fs as default, ps as mountLibrary };
