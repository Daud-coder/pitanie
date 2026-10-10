/* «Питание» — приложение к Google Таблице «Питание».
   Данные у того же скрипта, что и кнопка iPhone «Записать еду» (вход по коду из таблицы).
   Последние данные хранятся на телефоне, чтобы открывалось без сети. */
(function () {
  'use strict';

  var API = 'https://script.google.com/macros/s/AKfycbzgMoZ1KUkrLRDGeaoGFnotEk0saxS0PTpN0f4dg5kNqUMIf3Rr-trCexrStO5aJwrGqA/exec';
  var K_PIN = 'pit.pin', K_DATA = 'pit.data', K_TAB = 'pit.tab', K_RANGE = 'pit.range';
  var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MEALS = ['Завтрак', 'Обед', 'Перекус', 'Ужин'];
  var MAC = [['p', 'Белки', '--p'], ['f', 'Жиры', '--f'], ['c', 'Углеводы', '--c']];
  var CHIPS = ['Кофе с молоком', '2 яйца', 'Овсянка с бананом', 'Куриная грудка 200 г с рисом', 'Протеин'];

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function addDays(s, k) { var p = s.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2] + k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dateOf(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  var state = { pin: store(K_PIN), data: store(K_DATA), day: null, tab: store(K_TAB) || 'day', range: store(K_RANGE) || 14, busy: false };

  /* ---------- сеть ---------- */
  function api(action, extra) {
    var body = Object.assign({ app: 1, pin: state.pin, action: action }, extra || {});
    // text/plain — без preflight, так Apps Script принимает кросс-доменный POST
    return fetch(API, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.auth === false) { logout(res.message); throw new Error(res.message); }
        return res;
      });
  }
  function refresh(quiet) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    if (!quiet) note('Обновляю…');
    return api('data').then(function (res) {
      if (!res.ok) throw new Error(res.message || 'Ошибка');
      setData(res);
      note('Обновлено в ' + new Date().toTimeString().slice(0, 5));
    }).catch(function (e) {
      note(navigator.onLine ? 'Не удалось обновить' : 'Нет сети — сохранённые данные');
      console.warn(e);
    }).then(function () { state.busy = false; });
  }
  function setData(res) {
    var wasToday = !state.day || (state.data && state.day === state.data.today);
    state.data = res; store(K_DATA, res);
    if (wasToday) state.day = res.today;
    render();
  }
  function note(t) { $('#syncNote').textContent = t; }

  /* ---------- вход ---------- */
  function showLock(msg) {
    $('#app').hidden = true; $('#lock').hidden = false;
    $('#lockErr').textContent = msg || '';
  }
  function logout(msg) { state.pin = null; drop(K_PIN); drop(K_DATA); state.data = null; showLock(msg); }
  $('#lockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pin = $('#pinInput').value.trim(), btn = e.target.querySelector('button');
    btn.disabled = true; $('#lockErr').textContent = '';
    state.pin = pin;
    api('data').then(function (res) {
      if (!res.ok) throw new Error(res.message);
      store(K_PIN, pin); $('#pinInput').value = '';
      state.day = res.today; start(); setData(res);
    }).catch(function (err) {
      $('#lockErr').textContent = err.message === 'Failed to fetch' ? 'Нет связи с сервером. Проверь интернет.' : err.message;
      state.pin = null;
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- расчёты ---------- */
  function itemsOf(day) { return (state.data.items || []).filter(function (i) { return i.date === day; }); }
  function total(list) {
    return list.reduce(function (t, i) { t.kcal += i.kcal; t.p += i.p; t.f += i.f; t.c += i.c; return t; }, { kcal: 0, p: 0, f: 0, c: 0 });
  }

  /* Активность из «Здоровья» (команда «Питание ⇄ Здоровье»). Бонус к норме — как на сервере:
     половина сожжённого сверх 600 ккал; обычные тренировки уже в коэффициенте активности. */
  function actOf(day) {
    var a = (state.data.activity || []).find(function (x) { return x.date === day; }) || null;
    return a && a.kcal > 6000 ? Object.assign({}, a, { kcal: 0 }) : a; // защита от сбоя единиц
  }
  function normFor(day) {
    var n = state.data.norm, a = actOf(day);
    if (!n) return null;
    var bonus = a && a.kcal > 600 ? Math.round((a.kcal - 600) / 2 / 10) * 10 : 0;
    return bonus ? Object.assign({}, n, { kcal: n.kcal + bonus, c: n.c + Math.round(bonus / 4), bonus: bonus }) : n;
  }

  /* ---------- отрисовка ---------- */
  function render() {
    if (!state.data) return;
    $$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === state.tab ? 'true' : 'false'); });
    $$('.view').forEach(function (v) { v.hidden = v.dataset.view !== state.tab; });
    if (state.tab === 'day') renderDay();
    if (state.tab === 'trend') renderTrend();
    if (state.tab === 'me') renderMe();
  }

  function renderStrip() {
    var today = state.data.today, html = '';
    for (var k = -6; k <= 0; k++) {
      var d = addDays(today, k), t = total(itemsOf(d)), dt = dateOf(d), norm = normFor(d);
      var pct = norm ? Math.min(100, t.kcal / norm.kcal * 100) : (t.kcal ? 100 : 0);
      var over = norm && t.kcal > norm.kcal * 1.05;
      html += '<button class="dayb" data-d="' + d + '" aria-pressed="' + (d === state.day) + '" aria-label="' + dt.getDate() + ' ' + MON[dt.getMonth()] + '">' +
        '<small>' + (k === 0 ? 'сег' : WD[dt.getDay()]) + '</small><b>' + dt.getDate() + '</b><i class="' + (over ? 'over' : '') + '"><u style="width:' + pct + '%"></u></i></button>';
    }
    $('#strip').innerHTML = html;
  }

  /* Кольцо: съеденное разбито по цветам — сколько ккал дали белки, жиры, углеводы; светлый остаток — сколько ещё можно. */
  function arc(r, w, from, to, color, cls) {
    var len = 2 * Math.PI * r, a = Math.max(0, to - from);
    if (a <= 0) return '';
    return '<circle class="' + (cls || '') + '" cx="100" cy="100" r="' + r + '" stroke-width="' + w + '" stroke="' + color + '" stroke-dasharray="' + (a * len) + ' ' + len + '" stroke-dashoffset="' + (-from * len) + '"/>';
  }
  /* Кольцо: зелёное — сколько ещё можно, красное — сколько съедено. Перебор — тёмно-красная дуга поверх. */
  function renderRing(t, n) {
    var css = getComputedStyle(document.documentElement), col = function (v) { return css.getPropertyValue(v).trim(); };
    var eaten = n ? Math.min(1, t.kcal / n.kcal) : 0, gap = eaten > 0 && eaten < 1 ? 0.008 : 0;
    var svg = n
      ? arc(80, 22, eaten + gap, 1 - gap, col('--ok'), 'seg') + arc(80, 22, 0, eaten, col('--eat'), 'seg seg--eat')
      : '<circle class="bgc" cx="100" cy="100" r="80" stroke-width="22"/>';
    if (n && t.kcal > n.kcal) svg += arc(80, 22, 0, Math.min(1, (t.kcal - n.kcal) / n.kcal), col('--over'), 'seg seg--over');
    $('#rings').innerHTML = svg;
  }

  var MEAL_IC = {
    'Завтрак': '<path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 6v3M5.6 9.6l1.8 1.8M18.4 9.6l-1.8 1.8"/>',
    'Обед': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    'Перекус': '<path d="M12 8c-3-2-7 0-7 4.5S8 21 10 21c1 0 1.4-.6 2-.6s1 .6 2 .6c2 0 5-4 5-8.5S15 6 12 8z"/><path d="M12 8c0-2 1-3.5 3-4"/>',
    'Ужин': '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'
  };
  var MEAL_COL = { 'Завтрак': '--m1', 'Обед': '--m2', 'Перекус': '--m3', 'Ужин': '--m4' };

  function renderDay() {
    renderStrip();
    var list = itemsOf(state.day), t = total(list), n = normFor(state.day), isToday = state.day === state.data.today;
    var a = actOf(state.day);
    $('#act').hidden = !a;
    if (a) {
      $('#aKcal').textContent = num(a.kcal) + ' ккал';
      $('#aBonus').textContent = n && n.bonus ? '+' + n.bonus + ' ккал к норме' : '';
      $('#aSteps').textContent = num(a.steps);
      $('#aStepsBar').style.width = Math.min(100, a.steps / 100) + '%'; // цель 10 000
    }
    renderRing(t, n);
    // центр кольца: главное — сколько осталось, ниже норма, мелко — процент
    var left = n ? n.kcal - Math.round(t.kcal) : null;
    var over = left !== null && left < 0;
    $('#kEatenL').textContent = n ? (over ? 'перебор' : isToday ? 'осталось' : 'не добрал') : 'съедено';
    $('#kEaten').textContent = n ? num(Math.abs(left)) : num(t.kcal);
    $('#kEaten').className = over ? 'over' : n ? 'ok' : '';
    $('#kOf').textContent = n ? 'норма ' + num(n.kcal) + ' ккал' : 'ккал';
    $('#kPct').textContent = n ? Math.round(t.kcal / n.kcal * 100) + '% съедено' : '';
    $('#split').hidden = !n;
    if (n) {
      $('#sEat').textContent = num(t.kcal);
      $('#sNorm').textContent = num(n.kcal);
      $('#sNormL').textContent = n.bonus ? 'Норма +' + n.bonus + ' за активность' : 'Норма';
    }
    $('#normCta').hidden = !!n;
    var sumK = t.p * 4 + t.f * 9 + t.c * 4 || 1;
    $('#macros').innerHTML = MAC.map(function (m, i) {
      var have = Math.round(t[m[0]]), need = n ? n[m[0]] : 0, kk = [4, 9, 4][i];
      var pct = need ? Math.min(100, have / need * 100) : 0;
      return '<li style="--dot:var(' + m[2] + ')"><span>' + m[1] + '</span><b>' + have + '<small>' + (need ? ' / ' + need : '') + ' г</small></b>' +
        '<div class="bar"><u style="width:' + pct + '%"></u></div><em>' + Math.round(have * kk / sumK * 100) + '% калорий' + (need && have < need ? ' · ещё ' + (need - have) + ' г' : '') + '</em></li>';
    }).join('');

    var tip = '';
    if (n && isToday && list.length) {
      var pl = n.p - Math.round(t.p);
      if (left < 0) tip = 'Норма на сегодня перебрана на ' + num(-left) + ' ккал — дальше лучше овощи и белок.';
      else if (pl > 25 && left > 150) tip = 'Белка не хватает ~' + pl + ' г: творог, курица, яйца или протеин.';
    }
    $('#tip').hidden = !tip; $('#tip').textContent = tip;

    var groups = {};
    list.forEach(function (i) { (groups[i.meal] = groups[i.meal] || []).push(i); });
    var order = MEALS.concat(Object.keys(groups).filter(function (m) { return MEALS.indexOf(m) < 0; })).filter(function (m) { return groups[m]; });

    $('#dayparts').hidden = !list.length;
    if (list.length) {
      var base = n ? Math.max(n.kcal, t.kcal) : t.kcal;
      $('#dpNote').textContent = n ? 'от нормы ' + num(n.kcal) : num(t.kcal) + ' ккал';
      $('#dpbar').innerHTML = order.map(function (m) {
        return '<i style="width:' + (total(groups[m]).kcal / base * 100) + '%;background:var(' + (MEAL_COL[m] || '--muted') + ')"></i>';
      }).join('');
      $('#dplegend').innerHTML = order.map(function (m) {
        var k = total(groups[m]).kcal;
        return '<li style="--mc:var(' + (MEAL_COL[m] || '--muted') + ')"><span>' + esc(m) + '</span><b>' + num(k) + '</b><small>' + Math.round(k / (t.kcal || 1) * 100) + '%</small></li>';
      }).join('');
    }

    if (!list.length) {
      $('#meals').innerHTML = '<div class="empty"><b>' + (isToday ? 'Сегодня пока пусто' : 'В этот день записей нет') + '</b>Нажми «Записать еду» или кнопку на iPhone.</div>';
      return;
    }
    $('#meals').innerHTML = order.map(function (m) {
      var g = groups[m], gt = total(g), c = MEAL_COL[m] || '--muted';
      var times = g.map(function (i) { return i.time; }).filter(Boolean).sort();
      return '<section class="meal" style="--mc:var(' + c + ')">' +
        '<header class="meal__h"><i class="meal__ic"><svg viewBox="0 0 24 24">' + (MEAL_IC[m] || MEAL_IC['Перекус']) + '</svg></i>' +
        '<div><h3>' + esc(m || 'Без приёма') + '</h3><small>' + g.length + ' ' + (g.length === 1 ? 'позиция' : g.length < 5 ? 'позиции' : 'позиций') + (times.length ? ' · ' + times[0] : '') + '</small></div>' +
        '<div class="meal__k"><b>' + num(gt.kcal) + '</b><small>ккал</small></div></header>' +
        '<p class="meal__m"><span style="color:var(--p)">Б ' + Math.round(gt.p) + '</span><span style="color:var(--f)">Ж ' + Math.round(gt.f) + '</span><span style="color:var(--c)">У ' + Math.round(gt.c) + '</span></p>' +
        g.map(function (i) {
          return '<button class="item" data-id="' + esc(i.id) + '"><b>' + esc(i.product) + '</b><strong>' + num(i.kcal) + '</strong>' +
            '<small>' + (i.grams ? i.grams + ' г · ' : '') + 'Б ' + Math.round(i.p) + ' · Ж ' + Math.round(i.f) + ' · У ' + Math.round(i.c) + '</small></button>';
        }).join('') + '</section>';
    }).join('');
  }

  function renderTrend() {
    $$('#range button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.r === state.range)); });
    var n = state.data.norm, today = state.data.today, days = [];
    for (var k = -(state.range - 1); k <= 0; k++) { var d = addDays(today, k); days.push({ d: d, t: total(itemsOf(d)), a: actOf(d) }); }
    var max = Math.max(n ? n.kcal * 1.2 : 0, Math.max.apply(null, days.map(function (x) { return x.t.kcal; })), 500);
    var html = days.map(function (x, i) {
      var h = x.t.kcal / max * 100, dt = dateOf(x.d);
      var showLbl = state.range <= 14 || i % 3 === (days.length - 1) % 3;
      var cls = !x.t.kcal ? 'zero' : n && x.t.kcal > n.kcal * 1.05 ? 'over' : '';
      return '<div class="col" title="' + dt.getDate() + ' ' + MON[dt.getMonth()] + ': ' + num(x.t.kcal) + ' ккал"><i class="' + cls + '" style="height:calc(' + h + '% - 17px)"></i><small>' + (showLbl ? dt.getDate() : '') + '</small></div>';
    }).join('');
    if (n) html += '<div class="normline" style="bottom:calc(' + (n.kcal / max) + ' * (100% - 17px) + 17px)"></div>';
    $('#cols').innerHTML = html;
    var filled = days.filter(function (x) { return x.t.kcal > 0; });
    var avg = filled.length ? total(filled.map(function (x) { return x.t; })) : null;
    if (avg) ['kcal', 'p', 'f', 'c'].forEach(function (k) { avg[k] /= filled.length; });
    $('#kAvg').textContent = avg ? 'в среднем ' + num(avg.kcal) + (n ? ' из ' + num(n.kcal) : '') : 'нет записей';
    $('#avgm').innerHTML = MAC.map(function (m) {
      var have = avg ? Math.round(avg[m[0]]) : 0, need = n ? n[m[0]] : 0;
      return '<li style="--dot:var(' + m[2] + ')"><span>' + m[1] + '</span><em>' + have + (need ? ' / ' + need + ' г · ' + Math.round(have / need * 100) + '%' : ' г') + '</em>' +
        '<div class="bar"><u style="width:' + (need ? Math.min(100, have / need * 100) : 0) + '%"></u></div></li>';
    }).join('');
    renderActivity(days);
    renderWeight();
  }

  function renderActivity(days) {
    var has = days.filter(function (x) { return x.a; });
    $('#actPanel').hidden = !has.length;
    if (!has.length) return;
    var max = Math.max.apply(null, has.map(function (x) { return x.a.kcal; }).concat([300]));
    $('#actCols').innerHTML = days.map(function (x, i) {
      var v = x.a ? x.a.kcal : 0, dt = dateOf(x.d);
      var showLbl = state.range <= 14 || i % 3 === (days.length - 1) % 3;
      return '<div class="col" title="' + dt.getDate() + ' ' + MON[dt.getMonth()] + ': ' + num(v) + ' ккал, ' + num(x.a ? x.a.steps : 0) + ' шагов"><i class="act' + (v ? '' : ' zero') + '" style="height:calc(' + (v / max * 100) + '% - 17px)"></i><small>' + (showLbl ? dt.getDate() : '') + '</small></div>';
    }).join('');
    var avgK = has.reduce(function (s, x) { return s + x.a.kcal; }, 0) / has.length, avgS = has.reduce(function (s, x) { return s + x.a.steps; }, 0) / has.length;
    $('#actAvg').textContent = 'ср. ' + num(avgK) + ' ккал · ' + (avgS >= 1000 ? (Math.round(avgS / 100) / 10).toString().replace('.', ',') + ' тыс.' : num(avgS)) + ' шагов';
  }

  function renderWeight() {
    var w = (state.data.weights || []).slice(-30);
    $('#wEmpty').hidden = w.length > 1; $('#wline').style.display = w.length > 1 ? '' : 'none';
    if (!w.length) { $('#wNote').textContent = ''; return; }
    var last = w[w.length - 1], first = w[0], diff = Math.round((last.kg - first.kg) * 10) / 10;
    $('#wNote').textContent = last.kg + ' кг' + (w.length > 1 ? ' · ' + (diff > 0 ? '+' : '') + diff + ' кг' : '');
    if (w.length < 2) return;
    var lo = Math.min.apply(null, w.map(function (x) { return x.kg; })) - 0.5, hi = Math.max.apply(null, w.map(function (x) { return x.kg; })) + 0.5;
    var pts = w.map(function (x, i) { return [i / (w.length - 1) * 316 + 2, 112 - (x.kg - lo) / (hi - lo) * 104]; });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    $('#wline').innerHTML = '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      '<circle cx="' + pts[pts.length - 1][0] + '" cy="' + pts[pts.length - 1][1] + '" r="4" fill="var(--accent)"/>';
  }

  function renderMe() {
    var p = state.data.profile || {}, n = state.data.norm, f = $('#profForm');
    $('#normBox').innerHTML = n
      ? '<small>Твоя норма в день</small><b>' + num(n.kcal) + ' ккал</b><div class="nm">' +
        MAC.map(function (m) { return '<div><span>' + m[1] + '</span><strong>' + n[m[0]] + ' г</strong></div>'; }).join('') + '</div>'
      : '<small>Норма ещё не посчитана</small><b>Заполни параметры</b>';
    if (document.activeElement && f.contains(document.activeElement)) return;
    ['age', 'height', 'weight', 'target', 'kcalManual'].forEach(function (k) { f.elements[k].value = p[k] || ''; });
    f.elements.activity.value = String(p.activity || '1.375');
    pick('#sexSeg', /^ж/i.test(p.sex || '') ? 'ж' : 'м');
    pick('#goalSeg', p.goal || 'поддержание');
  }
  function pick(seg, v) { $$(seg + ' button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === v)); }); }
  function picked(seg) { var b = $(seg + ' [aria-pressed="true"]'); return b ? b.dataset.v : ''; }

  /* ---------- шторки ---------- */
  var openSheet = null;
  function show(id) {
    hide(); openSheet = $(id);
    $('#veil').hidden = false; openSheet.hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { $('#veil').classList.add('on'); openSheet.classList.add('on'); }); });
  }
  function hide() {
    if (!openSheet) return;
    var s = openSheet; openSheet = null;
    s.classList.remove('on'); $('#veil').classList.remove('on');
    setTimeout(function () { if (!openSheet) { s.hidden = true; $('#veil').hidden = true; } else s.hidden = true; }, 300);
  }
  var toastT;
  function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2400); }

  /* ---------- события ---------- */
  function start() {
    $('#lock').hidden = true; $('#app').hidden = false;
    render();
  }

  $('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab; store(K_TAB, state.tab); render(); window.scrollTo(0, 0);
  });
  $('#strip').addEventListener('click', function (e) {
    var b = e.target.closest('.dayb'); if (!b) return;
    state.day = b.dataset.d; renderDay();
  });
  $('#range').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.range = +b.dataset.r; store(K_RANGE, state.range); renderTrend();
  });
  $('#veil').addEventListener('click', hide);
  $$('[data-close]').forEach(function (b) { b.addEventListener('click', hide); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });

  $('#chips').innerHTML = CHIPS.map(function (c) { return '<button type="button">' + esc(c) + '</button>'; }).join('');
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var t = $('#addText'); t.value = (t.value.trim() ? t.value.trim() + ', ' : '') + b.textContent.toLowerCase(); t.focus();
  });
  $('#addBtn').addEventListener('click', function () {
    $('#addRes').textContent = ''; $('#addRes').className = 'res';
    show('#addSheet'); setTimeout(function () { $('#addText').focus(); }, 320);
  });
  $('#addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = $('#addText').value.trim(); if (!text) return;
    var day = state.day !== state.data.today ? ' (' + dateOf(state.day).getDate() + ' ' + MON[dateOf(state.day).getMonth()] + ')' : '';
    var btn = $('#addGo'); btn.disabled = true; btn.textContent = 'Считаю…';
    api('add', { text: text + day }).then(function (res) {
      $('#addRes').textContent = res.message || ''; $('#addRes').className = 'res ' + (res.ok ? 'ok' : 'err');
      if (res.ok) { $('#addText').value = ''; refresh(true); }
    }).catch(function (err) { $('#addRes').textContent = err.message; $('#addRes').className = 'res err'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Посчитать и записать'; });
  });

  $('#normCta').addEventListener('click', function () { state.tab = 'me'; store(K_TAB, 'me'); render(); window.scrollTo(0, 0); });
  $('#askBtn').addEventListener('click', function () { show('#askSheet'); });
  $('#askForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#askGo'); btn.disabled = true; btn.textContent = 'Думаю…';
    $('#askRes').textContent = ''; $('#askRes').className = 'res res--advice';
    api('advice', { question: $('#askText').value.trim() }).then(function (res) {
      $('#askRes').textContent = res.message || ''; $('#askRes').className = 'res res--advice ' + (res.ok ? 'ok' : 'err');
    }).catch(function (err) { $('#askRes').textContent = err.message; $('#askRes').className = 'res err'; })
      .then(function () { btn.disabled = false; btn.textContent = 'Спросить'; });
  });

  var currentItem = null;
  $('#meals').addEventListener('click', function (e) {
    var b = e.target.closest('.item'); if (!b) return;
    currentItem = (state.data.items || []).find(function (i) { return i.id === b.dataset.id; });
    if (!currentItem) return;
    var i = currentItem;
    $('#itemInfo').innerHTML = '<b>' + esc(i.product) + '</b><span>' + num(i.kcal) + ' ккал · Б ' + i.p + ' · Ж ' + i.f + ' · У ' + i.c + '</span><small>' +
      esc(i.meal) + (i.grams ? ' · ' + i.grams + ' г' : '') + (i.time ? ' · ' + esc(i.time) : '') + '</small>';
    $('#itemRes').textContent = '';
    show('#itemSheet');
  });
  $('#delBtn').addEventListener('click', function () {
    if (!currentItem) return;
    var btn = $('#delBtn'); btn.disabled = true;
    api('undo', { id: currentItem.id }).then(function (res) {
      if (!res.ok) throw new Error(res.message);
      state.data.items = state.data.items.filter(function (i) { return i.id !== currentItem.id; });
      store(K_DATA, state.data); hide(); renderDay(); toast('Удалено');
    }).catch(function (err) { $('#itemRes').textContent = err.message; $('#itemRes').className = 'res err'; })
      .then(function () { btn.disabled = false; });
  });

  $('#sexSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) pick('#sexSeg', b.dataset.v); });
  $('#goalSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) pick('#goalSeg', b.dataset.v); });
  $('#profForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, btn = $('#profBtn');
    var profile = { sex: picked('#sexSeg'), goal: picked('#goalSeg'), activity: Number(f.elements.activity.value),
      age: Number(f.elements.age.value) || '', height: Number(f.elements.height.value) || '',
      weight: Number(String(f.elements.weight.value).replace(',', '.')) || '', kcalManual: Number(f.elements.kcalManual.value) || '', target: Number(String(f.elements.target.value).replace(',', '.')) || '' };
    btn.disabled = true; $('#profRes').textContent = '';
    api('profile', { profile: profile }).then(function (res) {
      if (!res.ok) throw new Error(res.message);
      state.data.profile = res.profile; state.data.norm = res.norm; store(K_DATA, state.data);
      if (document.activeElement) document.activeElement.blur();
      renderMe(); toast('Сохранено'); refresh(true);
    }).catch(function (err) { $('#profRes').textContent = err.message; $('#profRes').className = 'res err'; })
      .then(function () { btn.disabled = false; });
  });

  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.pin) refresh(true); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});

  if (!state.pin) showLock();
  else { if (state.data) state.day = state.data.today; start(); refresh(); }
})();
