/* ============================================================
   app.js — 地球の傾きと四季
   地球を「横から見た球」として、緯度経度の格子を正射影で描く。
   座標：X=右、Y=上、Z=手前。太陽は左（-X方向）にあり、昼夜の境目は縦の線になる。
   ============================================================ */
(function () {
  "use strict";

  var R = Math.PI / 180;
  var DAY = 86400000;
  var JST = 9 * 3600000;
  var EPS0 = 23.44;                       // 現在の地軸の傾き（度）

  var CITIES = [
    { n: "東京", lat: 35.7, lon: 139.7 },
    { n: "札幌", lat: 43.1, lon: 141.4 },
    { n: "那覇", lat: 26.2, lon: 127.7 },
    { n: "レイキャビク（アイスランド）", lat: 64.1, lon: -21.9 },
    { n: "ロンドン", lat: 51.5, lon: -0.1 },
    { n: "ニューヨーク", lat: 40.7, lon: -74.0 },
    { n: "ナイロビ（赤道の近く）", lat: -1.3, lon: 36.8 },
    { n: "シドニー", lat: -33.9, lon: 151.2 },
    { n: "ケープタウン", lat: -33.9, lon: 18.4 },
    { n: "北極点", lat: 90, lon: 0 },
    { n: "南極点", lat: -90, lon: 0 }
  ];

  var tilt1 = 23.4, cityI = 0, hour = 12, playing = false, lastFrame = 0;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  function hm(h) {            // 時（小数）→ "6:05"
    var m = Math.round(h * 60), hh = Math.floor(m / 60) % 24, mm = m % 60;
    return hh + ":" + pad(mm);
  }
  function dur(h) { var m = Math.round(h * 60); return Math.floor(m / 60) + "時間" + pad(m % 60) + "分"; }
  function lat(v) { return (v >= 0 ? "北緯" : "南緯") + Math.abs(v).toFixed(1) + "°"; }

  /* ---------- 太陽の位置 ---------- */
  function jst(t) {
    var d = new Date(t + JST);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
             h: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 };
  }
  function sunLon(t) {                    // 太陽の黄経（度）。春分点が0度
    var d = t / DAY + 2440587.5 - 2451545;
    var q = 280.459 + 0.98564736 * d, g = (357.529 + 0.98560028 * d) * R;
    return ((q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) % 360 + 360) % 360;
  }
  function declination(L, eps) { return Math.asin(Math.sin(eps * R) * Math.sin(L * R)) / R; }
  function eotMin(t) {                    // 均時差（分）
    var j = jst(t), n = (Date.UTC(j.y, j.m - 1, j.d) - Date.UTC(j.y, 0, 0)) / DAY;
    var B = 360 / 365 * (n - 81) * R;
    return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  }

  /* 緯度φ・太陽の赤緯δの日の、日の出入り（地方太陽時）と昼の長さ */
  function dayInfo(phi, dec) {
    var p = Math.max(-89.9, Math.min(89.9, phi)) * R, d = dec * R;
    var x = -Math.tan(p) * Math.tan(d);
    var noonAlt = 90 - Math.abs(phi - dec);
    if (x >= 1) return { kind: "night", noonAlt: noonAlt, len: 0 };
    if (x <= -1) return { kind: "day", noonAlt: noonAlt, len: 24 };
    var H = Math.acos(x) / R / 15;
    return { kind: "normal", rise: 12 - H, set: 12 + H, len: 2 * H, noonAlt: noonAlt };
  }
  function sunAlt(phi, dec, h) {          // 地方太陽時 h の太陽高度（度）
    var p = phi * R, d = dec * R, H = 15 * (h - 12) * R;
    return Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H)) / R;
  }

  /* ---------- 地球の描画 ---------- */
  function sunRays(id) {
    var ys = [90, 135, 180, 225, 270];      // 太陽は右。光は右から左へ進む
    var out = '<defs><marker id="' + id + '" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">' +
      '<path d="M0 0L8 4L0 8Z" style="fill:var(--gold)"/></marker></defs>' +
      '<circle cx="654" cy="180" r="52" style="fill:var(--gold);opacity:.85"/>';
    ys.forEach(function (y) {
      out += '<line x1="584" y1="' + y + '" x2="440" y2="' + y + '" style="stroke:var(--gold);stroke-width:1.5" marker-end="url(#' + id + ')"/>';
    });
    return out + '<text x="530" y="66" text-anchor="middle" style="fill:var(--dim);font-size:13px">太陽の光</text>';
  }

  /* 夜の側の形。s2 は画面から見た太陽の向き。昼夜の境目（大円）は楕円に見える */
  function nightPath(s2, cx, cy, Rr) {
    var m = Math.sqrt(s2[0] * s2[0] + s2[1] * s2[1]), d = "", i;
    if (m < 1e-6) {
      return s2[2] < 0 ? "M" + (cx - Rr) + " " + cy + "a" + Rr + " " + Rr + " 0 1 0 " + 2 * Rr + " 0a" + Rr + " " + Rr + " 0 1 0 " + (-2 * Rr) + " 0Z" : "";
    }
    var u = [s2[0] / m, s2[1] / m], b1 = [-u[1], u[0]], c2 = [-s2[2] * u[0], -s2[2] * u[1]];
    var pt = function (x, y) { return (cx + Rr * x).toFixed(1) + " " + (cy - Rr * y).toFixed(1); };
    for (i = 0; i <= 60; i++) {          // 境目の手前側：b1 から -b1 へ
      var t = Math.PI * i / 60;
      d += (i ? "L" : "M") + pt(Math.cos(t) * b1[0] + Math.sin(t) * c2[0], Math.cos(t) * b1[1] + Math.sin(t) * c2[1]);
    }
    var beta = Math.atan2(b1[1], b1[0]);
    for (i = 1; i <= 60; i++) {          // 縁を、太陽と反対側（夜）まわりで b1 へ戻る
      var th = beta + Math.PI - Math.PI * i / 60;
      d += "L" + pt(Math.cos(th), Math.sin(th));
    }
    return d + "Z";
  }

  /* 視点を街に合わせたとき：太陽の方向を示すしるし */
  function sunMark(s2, cx, cy, Rr) {
    var m = Math.sqrt(s2[0] * s2[0] + s2[1] * s2[1]), ux = m < 1e-6 ? -1 : s2[0] / m, uy = m < 1e-6 ? 0 : s2[1] / m;
    var x = cx + 1.55 * Rr * ux, y = cy - 1.55 * Rr * uy, front = s2[2] > 0.15, back = s2[2] < -0.15;
    return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="22" style="fill:var(--gold);opacity:' + (back ? .25 : .9) + '"/>' +
      '<text x="' + x.toFixed(1) + '" y="' + (y + 40).toFixed(1) + '" text-anchor="middle" style="fill:var(--gold);font-size:13px">太陽' +
      (front ? "（手前）" : back ? "（裏側）" : "") + "</text>";
  }

  /* o: { eps, L(太陽黄経), H0(経度0度の時角), mark:{lat,lon,n}, id, follow } */
  function globe(o) {
    var cx = o.follow ? 320 : 270, cy = 180, Rr = 140;
    var eps = o.eps * R, L = o.L * R, sE = Math.sin(eps), cE = Math.cos(eps);
    var a = [-sE * Math.sin(L), cE, -sE * Math.cos(L)];          // 地軸（北向き）
    var sa = -a[0];                                              // 太陽方向 s=(-1,0,0) との内積
    var e1 = [-1 - sa * a[0], -sa * a[1], -sa * a[2]], n = Math.sqrt(dot(e1, e1));
    e1 = n < 1e-6 ? [0, 0, 1] : [e1[0] / n, e1[1] / n, e1[2] / n];   // 赤道面内で太陽に向く方向
    var e2 = cross(a, e1);                                       // 東向き（自転の向き）

    var aw = a;                          // 太陽を基準にした座標での地軸（視点を回す前）
    function Pw(la, lo) {                // 太陽を基準にした座標での、緯度・経度の点
      var h = (o.H0 + lo) * R, c = Math.cos(la * R), k = Math.sin(la * R), ch = Math.cos(h), sh = Math.sin(h);
      return [c * (ch * e1[0] + sh * e2[0]) + k * aw[0], c * (ch * e1[1] + sh * e2[1]) + k * aw[1], c * (ch * e1[2] + sh * e2[2]) + k * aw[2]];
    }
    // 視点
    //  follow：地球と一緒に地軸のまわりを回るカメラ。選んだ都市の子午線がいつも手前を向き、
    //          地軸の傾きも都市も止まって見える。動くのは、太陽と昼夜の境目のほう
    //  それ以外：太陽の真横から見る。左右を反転して、太陽が画面の右に来るようにする（反対側から見た図）
    var rot, flip;
    if (o.follow && o.mark) {
      var Hc = (o.H0 + o.mark.lon) * R, ch0 = Math.cos(Hc), sh0 = Math.sin(Hc);
      var Zc = [ch0 * e1[0] + sh0 * e2[0], ch0 * e1[1] + sh0 * e2[1], ch0 * e1[2] + sh0 * e2[2]];
      var Wc = cross(aw, Zc), st0 = Math.sin(o.eps * R), ct0 = Math.cos(o.eps * R);
      var Xc = [st0 * aw[0] + ct0 * Wc[0], st0 * aw[1] + ct0 * Wc[1], st0 * aw[2] + ct0 * Wc[2]];
      var Yc = [ct0 * aw[0] - st0 * Wc[0], ct0 * aw[1] - st0 * Wc[1], ct0 * aw[2] - st0 * Wc[2]];
      rot = function (v) { return [dot(v, Xc), dot(v, Yc), dot(v, Zc)]; };
      flip = function (v) { return v; };
    } else {
      rot = function (v) { return v; };
      flip = function (v) { return [-v[0], v[1], v[2]]; };
    }
    function P(la, lo) { return flip(rot(Pw(la, lo))); }
    var s2 = flip(rot([-1, 0, 0]));      // 画面から見た太陽の方向
    a = flip(rot(a));
    function X(p) { return (cx + Rr * p[0]).toFixed(1); }
    function Y(p) { return (cy - Rr * p[1]).toFixed(1); }
    function curve(pts) {               // 手前側（z>0）だけをつなぐ
      var d = "", pen = false;
      pts.forEach(function (p) {
        if (p[2] > 0.001) { d += (pen ? "L" : "M") + X(p) + " " + Y(p); pen = true; } else { pen = false; }
      });
      return d;
    }
    function latPath(la) { var s = []; for (var l = 0; l <= 360; l += 4) s.push(P(la, l)); return curve(s); }
    function lonPath(lo) { var s = []; for (var l = -90; l <= 90; l += 3) s.push(P(l, lo)); return curve(s); }
    function stroke(d, color, w, op, dash) {
      return '<path d="' + d + '" fill="none" style="stroke:' + color + ';stroke-width:' + w + ';opacity:' + op +
        (dash ? ";stroke-dasharray:5 5" : "") + '"/>';
    }

    var out = o.follow ? sunMark(s2, cx, cy, Rr) : sunRays(o.id);
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + Rr + '" style="fill:var(--sea);opacity:.3"/>';
    [-60, -30, 30, 60].forEach(function (la) { out += stroke(latPath(la), "var(--dim)", 1, 0.35); });
    for (var lo = 0; lo < 360; lo += 30) out += stroke(lonPath(lo), "var(--dim)", 1, 0.35);
    out += stroke(latPath(0), "var(--gold)", 1.8, 0.85);
    if (o.eps > 0.5) {
      [o.eps, -o.eps].forEach(function (la) { out += stroke(latPath(la), "var(--gold)", 1.4, 0.7, true); });
      var pc = 90 - o.eps;
      if (pc > 0.5) [pc, -pc].forEach(function (la) { out += stroke(latPath(la), "var(--sea)", 1.6, 1, true); });
    }
    out += '<path d="' + nightPath(s2, cx, cy, Rr) + '" style="fill:#04060e;opacity:.55"/>';
    out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + Rr + '" fill="none" style="stroke:var(--dim);opacity:.6"/>';
    // 地軸
    var ax = 1.28;
    out += '<line x1="' + (cx - ax * Rr * a[0]).toFixed(1) + '" y1="' + (cy + ax * Rr * a[1]).toFixed(1) + '" x2="' + (cx + ax * Rr * a[0]).toFixed(1) +
      '" y2="' + (cy - ax * Rr * a[1]).toFixed(1) + '" style="stroke:var(--moon);stroke-width:2;opacity:.9"/>' +
      '<text x="' + (cx + (ax + .1) * Rr * a[0]).toFixed(1) + '" y="' + (cy - (ax + .1) * Rr * a[1] + 5).toFixed(1) + '" text-anchor="middle" style="fill:var(--moon);font-size:14px">北</text>';
    if (a[2] > 0) out += '<circle cx="' + X(a) + '" cy="' + Y(a) + '" r="4" style="fill:var(--moon)"/>';
    // 都市
    if (o.mark) {
      var p = P(o.mark.lat, o.mark.lon);
      if (p[2] > 0.02) {
        out += '<circle cx="' + X(p) + '" cy="' + Y(p) + '" r="6" style="fill:var(--gold);stroke:var(--bg);stroke-width:1.5"/>' +
          '<text x="' + (+X(p) + 10) + '" y="' + (+Y(p) - 8) + '" style="fill:var(--gold);font-size:13px">' + o.mark.n.split("（")[0] + "</text>";
      }
    }
    return '<svg viewBox="0 0 640 360" role="img" aria-label="太陽の光を受けて、昼と夜に分かれた地球">' + out + "</svg>";
  }

  /* ---------- いまの地球 ---------- */
  function renderNow() {
    var t = Date.now(), j = jst(t), L = sunLon(t), dec = declination(L, EPS0);
    var utc = (t % DAY) / 3600000, H0 = (utc - 12) * 15 + eotMin(t) / 4;
    var tokyo = CITIES[0], h = 12 + (H0 + tokyo.lon) / 15;
    h = ((h % 24) + 24) % 24;
    var alt = sunAlt(tokyo.lat, dec, h), di = dayInfo(tokyo.lat, dec);
    var state = alt > 0 ? "昼（太陽は地平線の上）" : alt > -6 ? "薄明（日の出前・日の入り後）" : "夜";
    $("now").innerHTML = '<div class="viz"><div>' +
      '<small>いまの地球（' + j.y + "年" + j.m + "月" + j.d + "日 " + hm(j.h) + "・日本時間）</small>" + globe({ eps: EPS0, L: L, H0: H0, mark: tokyo, id: "ah0", follow: true }) +
      "</div><dl>" +
      "<dt>太陽が真上の緯度</dt><dd>" + lat(dec) + "</dd>" +
      "<dt>太陽が真上の経度</dt><dd>" + (function () { var lo = -H0; lo = ((lo + 540) % 360) - 180; return (lo >= 0 ? "東経" : "西経") + Math.abs(lo).toFixed(0) + "°"; })() + "</dd>" +
      "<dt>地軸の傾き</dt><dd>" + EPS0.toFixed(1) + "°</dd>" +
      "<dt>東京はいま</dt><dd>" + state + "</dd>" +
      "<dt>東京の太陽高度</dt><dd>" + alt.toFixed(0) + "°</dd>" +
      "<dt>東京の今日の昼</dt><dd>" + dur(di.len) + "</dd>" +
      "</dl></div>";
  }

  /* ---------- ① 地軸 ---------- */
  function renderC1() {
    var t = tilt1, z = 90 - t;
    $("tilt-val").textContent = t.toFixed(1) + "°";
    $("g1").innerHTML = globe({ eps: t, L: 90, H0: -135, mark: CITIES[0], id: "ah1" });

    var x = function (v) { return 110 + v / 90 * 500; };
    var bar = function (y, a, b, color, label) {
      return '<text x="100" y="' + (y + 12) + '" text-anchor="end" style="fill:var(--dim);font-size:13px">' + label + "</text>" +
        '<rect x="' + x(a).toFixed(1) + '" y="' + y + '" width="' + Math.max(0, x(b) - x(a)).toFixed(1) + '" height="18" rx="3" style="fill:' + color + ';opacity:.75"/>';
    };
    var out = bar(20, 0, t, "var(--gold)", "熱帯") +
      bar(50, t, Math.max(t, z), "var(--moon)", "温帯") +
      bar(80, z, 90, "var(--sea)", "寒帯");
    [0, 30, 60, 90].forEach(function (v) {
      out += '<text x="' + x(v) + '" y="132" text-anchor="middle" style="fill:var(--dim);font-size:13px">' + v + "°</text>";
    });
    out += '<text x="360" y="148" text-anchor="middle" style="fill:var(--dim);font-size:12px">← 赤道　　　　緯度　　　　極 →</text>';
    $("zone-fig").innerHTML = out;

    if (t < 1) {
      $("zone-text").innerHTML = "傾き <strong>0°</strong>：回帰線も極圏もなくなり、熱帯・温帯・寒帯の区分がありません。<strong>季節がなく</strong>、赤道ほど暑く、極ほど寒い、というだけの地球になります。";
      return;
    }
    var verdict = t < 1 ? "季節がありません。" : t < 15 ? "季節の差は小さくなります。" :
      t < 30 ? "穏やかな四季になります（いまの地球）。" : t < 60 ? "夏と冬の差が、大きくなります。" : "季節がとても極端になります。";
    $("zone-text").innerHTML = "傾き <strong>" + t.toFixed(1) + "°</strong>：熱帯は緯度0〜" + t.toFixed(1) + "°、" +
      (t < 45 ? "温帯は" + t.toFixed(1) + "〜" + z.toFixed(1) + "°、" : "温帯はなく（熱帯と寒帯が重なり）、") +
      "寒帯は" + z.toFixed(1) + "〜90°。<strong>" + verdict + "</strong>";
  }

  /* 斜め上から見た、4つの季節の地球 */
  function renderAxis() {
    var cx = 320, cy = 150, rx = 240, ry = 75, tl = EPS0 * R;
    var out = '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" style="stroke:var(--line);stroke-dasharray:4 6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="22" style="fill:var(--gold)"/>' +
      '<text x="' + cx + '" y="' + (cy + 42) + '" text-anchor="middle" style="fill:var(--dim);font-size:13px">太陽</text>';
    [[180, "6月ごろ", -1], [270, "9月ごろ", 1], [0, "12月ごろ", 1], [90, "3月ごろ", 1]].forEach(function (s) {
      var a = s[0] * R, x = cx + rx * Math.cos(a), y = cy - ry * Math.sin(a);
      var rot = Math.atan2(cy - y, cx - x) / R - 180;
      var ex = 40 * Math.sin(tl), ey = 40 * Math.cos(tl);
      out += '<g transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) + ')">' +
        '<circle r="20" style="fill:var(--line);stroke:var(--dim)"/>' +
        '<g transform="rotate(' + rot.toFixed(1) + ')"><path d="M0 -20A20 20 0 0 0 0 20Z" style="fill:var(--sea)"/></g>' +
        '<line x1="' + (-ex).toFixed(1) + '" y1="' + ey.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + (-ey).toFixed(1) + '" style="stroke:var(--moon);stroke-width:2"/>' +
        '<circle cx="' + ex.toFixed(1) + '" cy="' + (-ey).toFixed(1) + '" r="3.5" style="fill:var(--moon)"/></g>' +
        '<text x="' + (x + (s[2] < 0 ? -30 : 30)).toFixed(1) + '" y="' + (y + 5).toFixed(1) + '" text-anchor="' + (s[2] < 0 ? "end" : "start") +
        '" style="fill:var(--dim);font-size:13px">' + s[1] + "</text>";
    });
    out += '<text x="' + cx + '" y="22" text-anchor="middle" style="fill:var(--moon);font-size:13px">↑ 北極星の方向（どの季節でも、地軸はほぼ同じ向き）</text>';
    $("axis-fig").innerHTML = out;
  }

  /* ---------- ② 昼と夜 ---------- */
  function today() {
    var t = Date.now(), j = jst(t);
    var noon = Date.UTC(j.y, j.m - 1, j.d, 3, 0);                 // 日本時間の正午
    return { j: j, L: sunLon(noon), dec: declination(sunLon(noon), EPS0), noon: noon };
  }
  function renderC2() {
    var td = today(), c = CITIES[cityI];
    $("hour-val").textContent = hm(hour);
    $("g2").innerHTML = globe({ eps: EPS0, L: td.L, H0: 15 * (hour - 12) - c.lon, mark: c, id: "ah2", follow: $("view").value === "follow" });

    var di = dayInfo(c.lat, td.dec), alt = sunAlt(c.lat, td.dec, hour);
    var state = alt > 0 ? "昼" : alt > -6 ? "薄明（日の出前・日の入り後の明るさ）" : "夜";
    var rows = "<dt>" + c.n.split("（")[0] + "のいま</dt><dd>" + state + "</dd>" +
      "<dt>太陽の高さ</dt><dd>" + alt.toFixed(0) + "°" + (alt < 0 ? "（地平線の下）" : "") + "</dd>";
    if (di.kind === "normal") {
      rows += "<dt>今日の日の出</dt><dd>" + hm(di.rise) + "</dd><dt>今日の日の入り</dt><dd>" + hm(di.set) + "</dd><dt>昼の長さ</dt><dd>" + dur(di.len) + "</dd>";
    } else {
      rows += "<dt>今日の太陽</dt><dd>" + (di.kind === "day" ? "一日中沈まない（白夜）" : "一日中昇らない（極夜）") + "</dd>";
    }
    rows += "<dt>正午の太陽の高さ</dt><dd>" + Math.max(0, di.noonAlt).toFixed(0) + "°</dd>";
    $("c2-info").innerHTML = rows;
  }

  function tableHTML(dec) {            // 都市くらべの表（太陽の赤緯 dec の日）
    var list = CITIES.filter(function (c) { return Math.abs(c.lat) < 89; }).slice().sort(function (a, b) { return b.lat - a.lat; });
    var html = "<tr><th>都市</th><th>緯度</th><th>昼の長さ</th><th>正午の太陽の高さ</th></tr>";
    list.forEach(function (c) {
      var di = dayInfo(c.lat, dec);
      var len = di.kind === "normal" ? dur(di.len) : di.kind === "day" ? "24時間（白夜）" : "0時間（極夜）";
      html += "<tr><td>" + c.n.split("（")[0] + "</td><td>" + lat(c.lat) + "</td><td>" + len + "</td><td>" + Math.max(0, di.noonAlt).toFixed(0) + "°</td></tr>";
    });
    return html;
  }
  function renderTable() {
    var td = today();
    $("table-note").innerHTML = "今日（" + td.j.m + "月" + td.j.d + "日）の、太陽が真上に来る緯度は<strong>" + lat(td.dec) +
      "</strong>です。春分・秋分のころ（3月20日と9月23日ごろ）は、太陽が赤道の真上に来て、世界中でほぼ12時間ずつになります。";
    $("day-table").innerHTML = tableHTML(td.dec);
  }

  /* ---------- ③ 四季 ---------- */
  var YEAR = jst(Date.now()).y, n3 = 1, city3 = 0, DEC = null;
  var NDAYS = (YEAR % 4 === 0 && YEAR % 100 !== 0) || YEAR % 400 === 0 ? 366 : 365;
  var TOKYO_TEMP = [5.4, 6.1, 9.4, 14.3, 18.8, 22.1, 25.7, 27.5, 24.2, 18.7, 13.3, 8.5];   // 月平均気温の目安（℃）

  function dayNo(m, d) { return (Date.UTC(YEAR, m - 1, d) - Date.UTC(YEAR, 0, 0)) / DAY; }
  function noonOf(n) { return Date.UTC(YEAR, 0, n, 3, 0); }
  function decOf(n) {
    if (!DEC) { DEC = []; for (var i = 1; i <= NDAYS; i++) DEC[i] = declination(sunLon(noonOf(i)), EPS0); }
    return DEC[n];
  }
  function sunKm(n) { return 149597871 * (1 - 0.01672 * Math.cos(2 * Math.PI * (n - 3) / 365.25)); }

  /* 1年の折れ線。fn(n) の値を ymin〜ymax で描き、選んだ日に印をつける */
  function yearChart(fn, ymin, ymax, ticks, unit, color) {
    var x = function (n) { return 56 + 564 * (n - 1) / (NDAYS - 1); };
    var y = function (v) { return 160 - 144 * (Math.max(ymin, Math.min(ymax, v)) - ymin) / (ymax - ymin); };
    var out = "", i, path = "";
    ticks.forEach(function (v) {
      out += '<line x1="56" y1="' + y(v).toFixed(1) + '" x2="620" y2="' + y(v).toFixed(1) + '" style="stroke:var(--line)"/>' +
        '<text x="50" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end" style="fill:var(--dim);font-size:12px">' + v + unit + "</text>";
    });
    for (i = 1; i <= 12; i++) {
      out += '<text x="' + x(dayNo(i, 15)).toFixed(1) + '" y="182" text-anchor="middle" style="fill:var(--dim);font-size:12px">' + i + "月</text>";
    }
    for (i = 1; i <= NDAYS; i++) path += (i > 1 ? "L" : "M") + x(i).toFixed(1) + " " + y(fn(i)).toFixed(1);
    var v0 = fn(n3);
    return out + '<path d="' + path + '" fill="none" style="stroke:' + color + ';stroke-width:2.5"/>' +
      '<line x1="' + x(n3).toFixed(1) + '" y1="16" x2="' + x(n3).toFixed(1) + '" y2="160" style="stroke:var(--gold);opacity:.6"/>' +
      '<circle cx="' + x(n3).toFixed(1) + '" cy="' + y(v0).toFixed(1) + '" r="6" style="fill:var(--gold)"/>';
  }

  /* 斜め上から見た公転軌道。選んだ日の地球 */
  function orbit3(L, j) {
    var cx = 320, cy = 150, rx = 240, ry = 75, tl = EPS0 * R;
    var out = '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="none" style="stroke:var(--line);stroke-dasharray:4 6"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="22" style="fill:var(--gold)"/>' +
      '<text x="' + cx + '" y="' + (cy + 42) + '" text-anchor="middle" style="fill:var(--dim);font-size:13px">太陽</text>';
    [[90, "夏至"], [180, "秋分"], [270, "冬至"], [0, "春分"]].forEach(function (k) {
      var a = (90 + k[0]) * R, x = cx + rx * Math.cos(a), y = cy - ry * Math.sin(a);
      var tx = x + (k[0] === 90 ? -16 : k[0] === 270 ? 16 : 0), ty = y + (k[0] === 180 ? 40 : k[0] === 0 ? -34 : 4);
      out += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" style="fill:var(--dim)"/>' +
        '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + (k[0] === 90 ? "end" : k[0] === 270 ? "start" : "middle") +
        '" style="fill:var(--dim);font-size:13px">' + k[1] + "</text>";
    });
    var a = (90 + L) * R, x = cx + rx * Math.cos(a), y = cy - ry * Math.sin(a);
    var rot = Math.atan2(cy - y, cx - x) / R - 180, ex = 44 * Math.sin(tl), ey = 44 * Math.cos(tl);
    out += '<g transform="translate(' + x.toFixed(1) + " " + y.toFixed(1) + ')">' +
      '<circle r="22" style="fill:var(--line);stroke:var(--dim)"/>' +
      '<g transform="rotate(' + rot.toFixed(1) + ')"><path d="M0 -22A22 22 0 0 0 0 22Z" style="fill:var(--sea)"/></g>' +
      '<line x1="' + (-ex).toFixed(1) + '" y1="' + ey.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + (-ey).toFixed(1) + '" style="stroke:var(--moon);stroke-width:2.5"/>' +
      '<circle cx="' + ex.toFixed(1) + '" cy="' + (-ey).toFixed(1) + '" r="4" style="fill:var(--moon)"/></g>' +
      '<text x="' + x.toFixed(1) + '" y="' + (y + 44 + (L > 90 && L < 270 ? 12 : 0)).toFixed(1) + '" text-anchor="middle" style="fill:var(--gold);font-size:14px">' + j.m + "月" + j.d + "日</text>" +
      '<text x="' + cx + '" y="22" text-anchor="middle" style="fill:var(--moon);font-size:13px">↑ 北極星の方向（地軸は、1年中この向き）</text>';
    return out;
  }

  /* 太陽の高さによる、光の広がり。幅の同じ光が、地面のどれだけの広さに当たるか */
  function beam(alt, label, sub, x0) {
    var w = 40, out = '<svg x="' + x0 + '" y="0" width="290" height="200" viewBox="0 0 290 200">' +
      '<line x1="0" y1="150" x2="290" y2="150" style="stroke:var(--dim);stroke-width:2"/>';
    if (alt > 1) {
      var a = alt * R, len = w / Math.sin(a), s = Math.cos(a) * 160, t = Math.sin(a) * 160, bx = 30;
      out += '<polygon points="' + bx + ",150 " + (bx + len).toFixed(1) + ",150 " + (bx + len + s).toFixed(1) + "," + (150 - t).toFixed(1) + " " + (bx + s).toFixed(1) + "," + (150 - t).toFixed(1) +
        '" style="fill:var(--gold);opacity:.4"/><line x1="' + bx + '" y1="150" x2="' + (bx + len).toFixed(1) + '" y2="150" style="stroke:var(--gold);stroke-width:5"/>';
    }
    return out + '<text x="145" y="172" text-anchor="middle" style="fill:var(--text);font-size:13px">' + label + '</text>' +
      '<text x="145" y="192" text-anchor="middle" style="fill:var(--dim);font-size:12px">' + sub + "</text></svg>";
  }

  /* 日射の1日平均（大気の上端）の、1年の変化 */
  function insolation(latD, n) {
    var p = latD * R, d = decOf(n) * R, x = -Math.tan(p) * Math.tan(d);
    var h0 = Math.acos(Math.max(-1, Math.min(1, x))), r = sunKm(n) / 149597871;
    return (h0 * Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.sin(h0)) / Math.PI / (r * r);
  }

  function renderLag() {
    var T = CITIES[0].lat, mn = Infinity, mx = -Infinity, i, path = "", pts = "";
    for (i = 1; i <= NDAYS; i++) { var q = insolation(T, i); mn = Math.min(mn, q); mx = Math.max(mx, q); }
    var x = function (n) { return 56 + 564 * (n - 1) / (NDAYS - 1); };
    var y = function (v) { return 150 - 120 * v; };                 // 0〜1
    var out = "";
    for (i = 1; i <= 12; i++) out += '<text x="' + x(dayNo(i, 15)).toFixed(1) + '" y="192" text-anchor="middle" style="fill:var(--dim);font-size:12px">' + i + "月</text>";
    for (i = 1; i <= NDAYS; i++) path += (i > 1 ? "L" : "M") + x(i).toFixed(1) + " " + y((insolation(T, i) - mn) / (mx - mn)).toFixed(1);
    var tmn = Math.min.apply(null, TOKYO_TEMP), tmx = Math.max.apply(null, TOKYO_TEMP);
    TOKYO_TEMP.forEach(function (v, k) {
      pts += (k ? "L" : "M") + x(dayNo(k + 1, 15)).toFixed(1) + " " + y((v - tmn) / (tmx - tmn)).toFixed(1);
    });
    var x1 = x(dayNo(6, 21)), x2 = x(dayNo(8, 15));
    out += '<path d="' + path + '" fill="none" style="stroke:var(--gold);stroke-width:2.5"/>' +
      '<path d="' + pts + '" fill="none" style="stroke:var(--sea);stroke-width:2.5"/>' +
      TOKYO_TEMP.map(function (v, k) {
        return '<circle cx="' + x(dayNo(k + 1, 15)).toFixed(1) + '" cy="' + y((v - tmn) / (tmx - tmn)).toFixed(1) + '" r="3.5" style="fill:var(--sea)"/>';
      }).join("") +
      '<line x1="' + x1.toFixed(1) + '" y1="20" x2="' + x1.toFixed(1) + '" y2="160" style="stroke:var(--gold);stroke-dasharray:4 4;opacity:.7"/>' +
      '<line x1="' + x2.toFixed(1) + '" y1="20" x2="' + x2.toFixed(1) + '" y2="160" style="stroke:var(--sea);stroke-dasharray:4 4;opacity:.7"/>' +
      '<line x1="' + x1.toFixed(1) + '" y1="22" x2="' + (x2 - 6).toFixed(1) + '" y2="22" style="stroke:var(--moon)"/>' +
      '<text x="' + ((x1 + x2) / 2).toFixed(1) + '" y="14" text-anchor="middle" style="fill:var(--moon);font-size:12px">約1か月半〜2か月のずれ</text>' +
      '<text x="' + (x1 - 6).toFixed(1) + '" y="174" text-anchor="end" style="fill:var(--gold);font-size:12px">日射のピーク（夏至）</text>' +
      '<text x="' + (x2 + 6).toFixed(1) + '" y="174" style="fill:var(--sea);font-size:12px">気温のピーク（8月）</text>';
    $("lag-fig").innerHTML = out;
  }

  function renderC3() {
    var t = noonOf(n3), j = jst(t), L = sunLon(t), dec = decOf(n3), c = CITIES[city3], cn = c.n.split("（")[0];
    $("date-val").textContent = j.m + "月" + j.d + "日";
    $("orbit3").innerHTML = orbit3(L, j);
    $("g3").innerHTML = globe({ eps: EPS0, L: L, H0: 15 * 3 - c.lon, mark: c, id: "ah3" });

    var di = dayInfo(c.lat, dec), si = Math.sin(Math.max(0, di.noonAlt) * R), q = Math.floor(L / 90);
    var season = ["春", "夏", "秋", "冬"];
    var rows = "<dt>太陽が真上の緯度</dt><dd>" + lat(dec) + "</dd>" +
      "<dt>太陽までの距離</dt><dd>約" + (sunKm(n3) / 1e4).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "万km</dd>" +
      "<dt>季節（天文学的）</dt><dd>北半球は" + season[q] + "、南半球は" + season[(q + 2) % 4] + "</dd>" +
      "<dt>" + cn + "の昼の長さ</dt><dd>" + (di.kind === "normal" ? dur(di.len) : di.kind === "day" ? "24時間（白夜）" : "0時間（極夜）") + "</dd>" +
      "<dt>正午の太陽の高さ</dt><dd>" + Math.max(0, di.noonAlt).toFixed(0) + "°</dd>" +
      "<dt>日射の強さ（正午）</dt><dd>真上のときの" + Math.round(si * 100) + "%</dd>";
    $("c3-info").innerHTML = rows;

    $("len-fig").innerHTML = yearChart(function (n) { return dayInfo(c.lat, decOf(n)).len; }, 0, 24, [0, 6, 12, 18, 24], "時間", "var(--moon)");
    $("alt-fig").innerHTML = yearChart(function (n) { return Math.max(0, dayInfo(c.lat, decOf(n)).noonAlt); }, 0, 90, [0, 30, 60, 90], "°", "var(--moon)");
    $("chart-label").innerHTML = "<strong>" + cn + "</strong>（" + lat(c.lat) + "）の、1年の変化";

    var alt = Math.max(0, di.noonAlt);
    $("beam-fig").innerHTML = beam(90, "太陽が真上（90°）", "光の幅 = 地面の幅（100%）", 20) +
      beam(alt, cn + "の正午（" + alt.toFixed(0) + "°）", alt > 1 ? "同じ光が約" + (1 / Math.sin(alt * R)).toFixed(1) + "倍の広さに薄まる（" + Math.round(si * 100) + "%）" : "太陽が昇らない", 330);
    $("day-table3").innerHTML = tableHTML(dec);
    $("table3-note").textContent = j.m + "月" + j.d + "日の、世界の都市くらべです。";
  }

  /* ---------- 回せる地球（写真を球に貼る） ---------- */
  function initSpin() {
    var cv = $("spin-cv"), ctx = cv.getContext("2d"), N = cv.width, img = new Image();
    var fallback = function () {       // 写真を読み出せないとき（file:// で開いたとき）は、平面を流して代用
      var d = document.createElement("div");
      d.id = "spin-fb";
      cv.parentNode.replaceChild(d, cv);
    };
    img.onerror = fallback;
    img.onload = function () {
      var tw = img.width, th = img.height, oc = document.createElement("canvas"), tex;
      oc.width = tw; oc.height = th;
      oc.getContext("2d").drawImage(img, 0, 0);
      try { tex = oc.getContext("2d").getImageData(0, 0, tw, th).data; } catch (e) { fallback(); return; }

      var c = N / 2, r = c - 6, t = EPS0 * R, ct = Math.cos(t), st = Math.sin(t);
      var sun = [0.55, 0.25, 0.8], sl = Math.sqrt(dot(sun, sun));
      sun = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
      var n = N * N, lon0 = new Float32Array(n), vy = new Float32Array(n), shade = new Float32Array(n), alpha = new Uint8ClampedArray(n);
      for (var py = 0; py < N; py++) {          // 回転に関係しない部分は、最初に1回だけ計算
        for (var px = 0; px < N; px++) {
          var x = (px - c) / r, y = (c - py) / r, q = x * x + y * y, i = py * N + px;
          if (q >= 1) continue;
          var z = Math.sqrt(1 - q), X = x * ct - y * st, Y = x * st + y * ct;
          lon0[i] = Math.atan2(X, z);
          vy[i] = (0.5 - Math.asin(Y) / Math.PI) * (th - 1);
          var k = x * sun[0] + y * sun[1] + z * sun[2], s = Math.max(0, Math.min(1, (k + 0.08) / 0.5));
          shade[i] = 0.07 + 0.93 * s * s * (3 - 2 * s);
          alpha[i] = Math.max(0, Math.min(1, (1 - Math.sqrt(q)) * r / 1.5)) * 255;
        }
      }
      var out = ctx.createImageData(N, N), d = out.data, spin = -140 * R, last = 0, drag = false, lastX = 0, visible = true;
      var auto = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.17;   // 約10度/秒

      function draw() {
        for (var i = 0; i < n; i++) {
          var o = i * 4;
          if (!alpha[i]) { d[o + 3] = 0; continue; }
          var u = ((lon0[i] - spin) / (2 * Math.PI) + 0.5) % 1; if (u < 0) u += 1;
          u *= tw;
          var x0 = Math.floor(u), fx = u - x0, x1 = (x0 + 1) % tw, y0 = Math.floor(vy[i]), fy = vy[i] - y0, y1 = Math.min(th - 1, y0 + 1);
          var a = (y0 * tw + x0) * 4, b = (y0 * tw + x1) * 4, e = (y1 * tw + x0) * 4, f = (y1 * tw + x1) * 4;
          var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy, g = shade[i] * 1.7;
          d[o]     = Math.min(255, (tex[a] * w00 + tex[b] * w10 + tex[e] * w01 + tex[f] * w11) * g);
          d[o + 1] = Math.min(255, (tex[a + 1] * w00 + tex[b + 1] * w10 + tex[e + 1] * w01 + tex[f + 1] * w11) * g);
          d[o + 2] = Math.min(255, (tex[a + 2] * w00 + tex[b + 2] * w10 + tex[e + 2] * w01 + tex[f + 2] * w11) * g);
          d[o + 3] = alpha[i];
        }
        ctx.putImageData(out, 0, 0);
      }
      function loop(ts) {
        if (visible && !document.hidden && ts - last > 33) {      // 約30fps
          if (!drag) spin += auto * Math.min(0.1, (ts - last) / 1000);
          last = ts;
          draw();
        }
        requestAnimationFrame(loop);
      }
      cv.addEventListener("pointerdown", function (ev) { drag = true; lastX = ev.clientX; cv.setPointerCapture(ev.pointerId); });
      cv.addEventListener("pointermove", function (ev) {
        if (!drag) return;
        spin += (ev.clientX - lastX) / (cv.getBoundingClientRect().width / 2);
        lastX = ev.clientX;
      });
      cv.addEventListener("pointerup", function () { drag = false; });
      cv.addEventListener("pointercancel", function () { drag = false; });
      if (window.IntersectionObserver) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }).observe(cv);
      draw();
      requestAnimationFrame(loop);
    };
    img.src = "img/earth-oct.jpg";
  }

  /* ---------- 操作 ---------- */
  function tick(ts) {
    if (!playing) return;
    hour = (hour + (ts - lastFrame) / 1000 * 2) % 24;            // 2時間/秒
    lastFrame = ts;
    $("hour").value = hour.toFixed(1);
    renderC2();
    requestAnimationFrame(tick);
  }

  function init() {
    $("city").innerHTML = CITIES.map(function (c, i) { return '<option value="' + i + '">' + c.n + "</option>"; }).join("");
    $("tilt").addEventListener("input", function () { tilt1 = +this.value; renderC1(); });
    $("presets").addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-t]");
      if (!b) return;
      tilt1 = +b.getAttribute("data-t");
      $("tilt").value = tilt1;
      renderC1();
    });
    $("city").addEventListener("change", function () { cityI = +this.value; renderC2(); });
    $("view").addEventListener("change", renderC2);
    $("hour").addEventListener("input", function () { hour = +this.value; renderC2(); });
    $("play").onclick = function () {
      playing = !playing;
      this.textContent = playing ? "停止" : "再生";
      if (playing) { lastFrame = performance.now(); requestAnimationFrame(tick); }
    };

    $("city3").innerHTML = $("city").innerHTML;
    $("date3").max = NDAYS;
    var td0 = jst(Date.now());
    n3 = dayNo(td0.m, td0.d);
    $("date3").value = n3;
    $("date3").addEventListener("input", function () { n3 = +this.value; renderC3(); });
    $("city3").addEventListener("change", function () { city3 = +this.value; renderC3(); });
    $("presets3").addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      var tdy = jst(Date.now());
      n3 = b.hasAttribute("data-today") ? dayNo(tdy.m, tdy.d) : dayNo(+b.getAttribute("data-m"), +b.getAttribute("data-d"));
      $("date3").value = n3;
      renderC3();
    });

    initSpin();
    renderNow(); renderC1(); renderAxis(); renderC2(); renderTable(); renderC3(); renderLag();
    setInterval(renderNow, 60000);
  }
  init();
})();
