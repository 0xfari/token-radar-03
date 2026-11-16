// Token Radar dashboard, radar-4: the ranked board, a filterable table, a per-protocol detail
// view with the model's maths and a farm plan, and the live-token set kept apart.
//
// The model: each pre-token protocol is priced at the fitted size curve itself — log10(market
// cap) against log10(TVL) over the snapshot's traded protocols, global slope, per-category
// intercept (shrunk toward the global intercept, weight n/(n+8); categories with fewer than 3
// comparables use the global curve), multiple clamped 0.05-1.20x. The curve was tested blind
// (80/20 holdout x30, and a time split that fits on old listings and prices new ones) before
// it was allowed to price anything. Implied = TVL x multiple x growth x maturity x breadth;
// each row carries a range [implied/2, implied x 2] from a leave-one-out backtest over the 128
// traded protocols (median error ~85%, ~2 in 3 inside 2x one-sided, 1 in 3 inside a symmetric
// +/-2x band): the board prices an order of magnitude. No protocol name is special-cased.
// Every farm plan is netted to the dollar at the low end of its own band.
//
// The page reads window.RADAR (data.js, written by main.ts from the same board) and generates
// each protocol's farm plan from the same rules the model used, so board and page always agree.
// No network: every byte the page needs ships with it.
(function () {
  var DATA = window.RADAR || null;
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchOnly: false };

  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + String(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    if (children !== undefined && children !== null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) { if (c) node.appendChild(c); });
    }
    return node;
  }

  // ---- the farm plan: the same rules lib/model.ts uses, so board and page agree ----
  // Each mechanism: category keywords, first position, weekly repeat, milestone.
  // {c} is the capital ("$75 of USDC"), {n} the protocol's name. First matching row wins.
  var MECH = [
    [['chain'], 'Bridge {c} to {n} and use two of its native apps, so the wallet is active on the chain itself.', 'Use one native app on the chain, such as a swap or a stake, so the wallet stays active.', 'a native app that records the wallet as an early user'],
    [['lend', 'cdp', 'collateral'], 'Supply {c} to {n} as a lender and keep the position open.', 'Adjust the supply once, or add a small borrow against it, so the wallet keeps moving.', 'the loan staying healthy, with collateral well above the liquidation line'],
    [['dex', 'amm', 'swap', 'liquidity manager'], 'Provide {c} of liquidity to {n}\'s main pool and keep the position open.', 'Swap a small amount through the pool, or rebalance the position, so the wallet keeps trading.', 'the liquidity position staying in range and earning fees'],
    [['bridge', 'cross chain'], 'Bridge {c} to another chain through {n} and use the bridged funds in an app there.', 'Bridge a small amount again, to a different chain when the route supports it.', 'bridged volume building up across more than one destination chain'],
    [['staking', 'restak'], 'Stake {c} of the chain\'s staking asset through {n} and keep the receipt token.', 'Top the stake up a little, or restake the rewards, so the position keeps growing.', 'the stake accruing rewards without ever leaving the protocol'],
    [['perpetual', 'derivative', 'options', 'basis'], 'Deposit {c} as margin on {n} and open one small hedged position.', 'Open and close one small trade, keeping the margin posted between trades.', 'trading volume that stays regular without blowing up the margin'],
    [['prediction'], 'Fund the account with {c} and place one position on a {n} market.', 'Place one more small position, on a different market when one is open.', 'positions across more than one market, not a single bet'],
    [['yield', 'vault', 'curator', 'allocator', 'leveraged farm', 'farm'], 'Deposit {c} into a {n} vault and keep the shares while they compound.', 'Add a small top-up to the vault, or move shares to a second vault when one opens.', 'the vault shares compounding instead of sitting idle'],
    [['stable', 'algo-stable'], 'Mint or deposit {c} of the stable asset through {n} and hold it.', 'Use the stable asset once, such as a swap or a deposit, so the wallet is not just holding.', 'the stable asset holding its peg while the position is open'],
    [['rwa'], 'Mint {c} of the protocol\'s yield-bearing asset on its chain and hold it.', 'Top the holding up a little, or use the asset as collateral where the protocol allows it.', 'the yield asset accruing returns for the whole holding period'],
    [['insurance'], 'Buy {c} of cover from {n} and keep the policy for the whole holding period.', 'Check the cover stays active, and renew it before it lapses.', 'the policy staying live for the full period'],
    [['launchpad', 'locker'], 'Hold {c} in the {n} contract and join one launch through it.', 'Keep the holding staked and join a new launch when one opens.', 'participation in more than one launch, not a single one'],
    [['payment', 'card'], 'Fund the account with {c} and make one real payment through {n}.', 'Make one more small payment, so the wallet shows repeated use.', 'payments that repeat over weeks, not a single transfer'],
    [['index', 'synthetic'], 'Mint or buy {c} of the index product through {n} and hold it.', 'Top the holding up a little, or rebalance it when the index rebalances.', 'the holding tracking the index without long gaps'],
    [[], 'Deposit {c} into {n} and keep the position open.', 'Repeat one qualifying action, such as a deposit, a swap, a vote or a borrow, so the wallet stays active.', 'activity landing in more than one snapshot'],
  ];
  var CHEAP = { Arbitrum: 1, Optimism: 1, Base: 1, Blast: 1, Linea: 1, Scroll: 1, Mantle: 1, Polygon: 1, Sonic: 1, Sui: 1, Avalanche: 1, Binance: 1, 'zkSync Era': 1 };
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1000000000) return 200;
    if (p.tvl_usd >= 100000000) return 120;
    return 75;
  }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 6;
    if (chain === 'Solana') return 0.05;
    if (chain === 'Hyperliquid L1') return 0.1;
    if (chain === 'Bitcoin') return 2;
    if (CHEAP[chain]) return 0.5;
    return 1;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function mechanismFor(p) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < MECH.length; i++) {
      var keys = MECH[i][0];
      var hit = keys.length === 0;
      for (var j = 0; j < keys.length; j++) if (c.indexOf(keys[j]) !== -1) { hit = true; break; }
      if (hit) return { action: MECH[i][1], weekly: MECH[i][2], watch: MECH[i][3] };
    }
    return { action: MECH[MECH.length - 1][1], weekly: MECH[MECH.length - 1][2], watch: MECH[MECH.length - 1][3] };
  }
  function farmSteps(p, age) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var gas = gasFor(chain);
    var hold = holdDaysFor(age);
    var mech = mechanismFor(p);
    var cap = '$' + capital + ' of USDC';
    var action = mech.action.split('{c}').join(cap).split('{n}').join(p.name);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $' + (gas + 2) + ' of gas for the first transaction', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: mech.weekly, cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, watching for ' + mech.watch + ', so the activity lands in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
  }
  function gasTotal(p, age) {
    var gas = gasFor(chainOf(p));
    var weeks = Math.max(1, Math.ceil(holdDaysFor(age) / 7));
    return Math.round((gas * (2 + weeks) + 0.5) * 10) / 10;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  // Exposed for the entry's own verification (main.ts must write the same six steps).
  window.RADAR_TEST = { farmSteps: farmSteps, stepText: stepText, gasTotal: gasTotal };

  // ---- state from the address hash: one link states the whole view ----
  function readHash() {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.tab = 'pre-token';
    state.sort = 'implied'; state.dir = -1; state.selected = null; state.watchOnly = false;
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('detail')) state.selected = params.get('detail');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('detail', state.selected);
    var h = params.toString();
    history.replaceState(null, '', h ? '#' + h : '#');
  }

  // ---- filtering and sorting ----
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else if (key === 'readiness') d = a.readiness - b.readiness;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days === null ? -1 : a.age_days) - (b.age_days === null ? -1 : b.age_days);
      else d = a.implied_value_usd - b.implied_value_usd;
      if (d === 0) d = a.slug < b.slug ? -1 : 1;
      return d * state.dir;
    });
  }
  function openDetail(slug) { state.selected = slug; writeHash(); render(); }
  function closeDetail() { state.selected = null; writeHash(); render(); }

  // ---- rendering ----
  function header() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('div', {}, [
      el('header', { class: 'hero' }, [
        el('h1', { html: 'Token Radar<span class="dot">.</span>' }),
        el('p', { text: 'Every protocol in the snapshot that records no token, ranked by what its launch would be worth — and what to do to farm it before it launches. Priced off the snapshot\'s own traded protocols, backtested, and shown with the range the pricing actually deserves.' }),
        el('div', { class: 'meta', text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Model ' + DATA.model_version + ' · Implied values are this radar’s own model, not a market price.' }),
      ]),
      el('div', { class: 'stats' }, [
        el('div', { class: 'stat' }, [el('span', { text: 'Watchlist' }), el('b', { text: String(DATA.watchlist_size) }), el('small', { text: 'protocols at or above the $50M floor' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Board rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early finds below the floor' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) }), el('small', { text: 'across the whole board' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Fit R²' }), el('b', { text: DATA.fit.r_squared.toFixed(2) }), el('small', { text: 'slope ' + DATA.fit.slope.toFixed(2) + ' over ' + DATA.fit.comps + ' traded protocols' })]),
        el('div', { class: 'stat' }, [el('span', { text: 'Backtest' }), el('b', { text: DATA.backtest.median_abs_pct + '% err' }), el('small', { text: DATA.backtest.within_2x_pct + '% within 2× · ' + DATA.backtest.within_2x_sym_pct + '% inside a symmetric ±2× band' })]),
      ]),
    ]);
  }

  function fitChart() {
    var pts = DATA.scatter;
    if (!pts || pts.length === 0) return null;
    var W = 560, H = 150, L = 46, R = 30, T = 8, B = 22;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var xmin = Math.floor(Math.min.apply(null, xs) - 0.2), xmax = Math.ceil(Math.max.apply(null, xs) + 0.2);
    var ymin = Math.floor(Math.min.apply(null, ys) - 0.2), ymax = Math.ceil(Math.max.apply(null, ys) + 0.2);
    var X = function (v) { return L + (v - xmin) / (xmax - xmin) * (W - L - R); };
    var Y = function (v) { return T + (ymax - v) / (ymax - ymin) * (H - T - B); };
    var s = '';
    var fmtTick = function (v) { if (v >= 9) return '$' + Math.pow(10, v - 9) + 'B'; if (v >= 6) return '$' + Math.pow(10, v - 6) + 'M'; return '$' + Math.pow(10, v - 3) + 'K'; };
    for (var gx = Math.ceil(xmin); gx <= xmax; gx++) {
      s += '<line class="grid" x1="' + X(gx).toFixed(1) + '" y1="' + Y(ymax).toFixed(1) + '" x2="' + X(gx).toFixed(1) + '" y2="' + Y(ymin).toFixed(1) + '"/>';
      s += '<text class="axis" x="' + X(gx).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + fmtTick(gx) + '</text>';
    }
    for (var gy = Math.ceil(ymin); gy <= ymax; gy++) {
      s += '<line class="grid" x1="' + X(xmin).toFixed(1) + '" y1="' + Y(gy).toFixed(1) + '" x2="' + X(xmax).toFixed(1) + '" y2="' + Y(gy).toFixed(1) + '"/>';
      s += '<text class="axis" x="' + (L - 6) + '" y="' + (Y(gy) + 3).toFixed(1) + '" text-anchor="end">' + fmtTick(gy) + '</text>';
    }
    pts.forEach(function (p) { s += '<circle class="dot" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="2.2"/>'; });
    var f = DATA.fit;
    s += '<line class="line" x1="' + X(xmin).toFixed(1) + '" y1="' + Y(f.intercept + f.slope * xmin).toFixed(1) + '" x2="' + X(xmax).toFixed(1) + '" y2="' + Y(f.intercept + f.slope * xmax).toFixed(1) + '"/>';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL for the traded protocols, with the fitted curve">' + s + '</svg>';
    return el('section', { class: 'fit' }, [
      el('h2', { text: 'What the market itself says a protocol is worth' }),
      el('div', { class: 'fitwrap' }, [
        el('div', { class: 'fitchart', html: svg }),
        el('div', { class: 'fitside' }, [
          el('p', { text: 'Market cap against TVL, one dot per traded protocol the snapshot carries, with the fitted curve.' }),
          el('p', { text: 'The curve is log10(market cap) = ' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' × log10(TVL), R² ' + f.r_squared.toFixed(2) + ' over ' + f.comps + ' protocols — and in this version the curve is the pricer, not a diagnostic: each category shifts it up or down by its own intercept.' }),
          el('p', { text: 'Size alone explains a fifth of the variance, so the curve is not trusted blindly: it was tested out of sample before it priced anything (blind holdout median error ' + DATA.backtest.blind_holdout.median_abs_pct + '%, time-split ' + DATA.backtest.time_split.map(function (t) { return t.median_abs_pct + '%'; }).join(' / ') + '%). The biggest protocols still price near the 0.05 floor — the curve says so, and the board shows it rather than hiding it behind a category median.' }),
        ]),
      ]),
    ]);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { 'aria-label': 'Filter by category' });
    cat.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories.forEach(function (c) { cat.appendChild(el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null })); });
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { 'aria-label': 'Filter by chain' });
    ch.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { ch.appendChild(el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null })); });
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var sort = el('select', { 'aria-label': 'Sort the board' });
    [['implied', 'Implied value'], ['readiness', 'Readiness'], ['tvl', 'TVL'], ['change', '7-day change'], ['age', 'Age without a token'], ['name', 'Name']].forEach(function (o) {
      sort.appendChild(el('option', { value: o[0], text: o[1], selected: o[0] === state.sort ? 'selected' : null }));
    });
    sort.addEventListener('change', function () { state.sort = sort.value; state.dir = -1; writeHash(); render(); });
    var watch = el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    var count = state.tab === 'pre-token' ? rows().length + ' of ' + DATA.rows.length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Search' }), search]),
      el('div', { class: 'field' }, [el('label', { text: 'Category' }), cat]),
      el('div', { class: 'field' }, [el('label', { text: 'Chain' }), ch]),
      el('div', { class: 'field' }, [el('label', { text: 'Sort by' }), sort]),
      el('label', { class: 'check' }, [watch, document.createTextNode('Watchlist only')]),
      el('div', { class: 'field' }, [el('label', { text: 'Token status' }), el('div', { class: 'tabs' }, [pre, live])]),
      el('span', { class: 'count', text: count }),
    ]);
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return el('th', {}, el('button', {
      type: 'button',
      text: label + arrow,
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); },
    }));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'empty' }, [
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Try a different search, category or chain.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render(); } }),
      ]);
    }
    var head = el('tr', {}, [
      sortHeader('implied', 'Rank'),
      sortHeader('name', 'Protocol'),
      el('th', { text: 'Category' }),
      el('th', { text: 'Chains' }),
      sortHeader('tvl', 'TVL'),
      sortHeader('change', '7d'),
      sortHeader('age', 'Age'),
      sortHeader('implied', 'Implied value'),
      el('th', { class: 'num', text: 'Multiple' }),
      sortHeader('readiness', 'Ready'),
      el('th', { class: 'num', text: 'Farm' }),
    ]);
    var body = el('tbody', {});
    list.forEach(function (r) {
      var chg = r.change_7d === null ? el('td', { class: 'num', text: '—' }) : el('td', { class: 'num ' + (r.change_7d >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) });
      var row = el('tr', {
        class: state.selected === r.slug ? 'selected' : null,
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
      }, [
        el('td', { class: 'num', text: '#' + r.rank }),
        el('td', {}, [document.createTextNode(r.name + ' '), el('span', { class: 'slug', text: r.slug }), r.watchlist ? el('span', { class: 'badge', text: '★ Watchlist' }) : null]),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        chg,
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num implied' }, [document.createTextNode(fmtUsd(r.implied_value_usd)), el('span', { class: 'range', text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) })]),
        el('td', { class: 'num', text: r.fitted_multiple.toFixed(2) + '×' }),
        el('td', { class: 'num' }, [el('span', { class: 'rbar' }, el('i', { style: 'width:' + r.readiness + '%' })), document.createTextNode(String(r.readiness))]),
        el('td', { class: 'num', text: '$' + r.farm_capital_usd + ' · ' + r.farm_hold_days + 'd' }),
      ]);
      body.appendChild(row);
    });
    var table = el('table', {}, [el('thead', {}, head), body]);
    return el('div', {}, [table, el('p', { class: 'note', text: 'Click a row for the protocol’s detail view and farm plan. ★ marks the 40 watchlist protocols at or above the $50M floor. The small range under each implied value is the backtest’s honest band: half to double. Ready is a 0–100 farm-now signal from growth, age without a token and chain breadth.' })]);
  }

  function liveTable() {
    var head = el('tr', {}, [
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: '7d' }), el('th', { class: 'num', text: 'Market cap' }),
    ]);
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', {}, [
        el('td', {}, [document.createTextNode(r.name + ' '), el('span', { class: 'slug', text: r.slug })]),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + ((r.change_7d || 0) >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num implied', text: fmtUsd(r.mcap_usd) }),
      ]));
    });
    return el('div', {}, [
      el('table', {}, [el('thead', {}, head), body]),
      el('p', { class: 'note', text: 'These protocols already trade: the board shows the market’s own value for them, never a model’s. They are kept apart from the ranked board.' }),
    ]);
  }

  function detailCard() {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === state.selected) { r = DATA.rows[i]; break; }
    if (!r) return null;
    var steps = farmSteps(r, r.age_days).map(stepText);
    var gas = gasTotal(r, r.age_days);
    var medKind = r.comps >= 3 ? 'category median ' : 'global median ';
    var math = 'TVL ' + fmtUsdFull(r.tvl_usd) + ' × ' + r.fitted_multiple.toFixed(2) + ' (fitted multiple from the size curve, intercept ' + r.curve_intercept.toFixed(2) + ', slope ' + r.global_slope.toFixed(2) + '; ' + medKind + r.category_multiple.toFixed(2) + '× over ' + r.comps + ' comparables, curve moves it ' + r.tilt_factor.toFixed(2) + '× off the median) × ' + r.growth_multiplier.toFixed(2) + ' (growth) × ' + r.maturity_multiplier.toFixed(2) + ' (maturity) × ' + r.breadth_multiplier.toFixed(2) + ' (breadth) ≈ ' + fmtUsdFull(r.implied_value_usd);
    return el('section', { class: 'detail', 'aria-label': 'Protocol detail' }, [
      el('h2', {}, [document.createTextNode('#' + r.rank + ' ' + r.name + ' '), r.watchlist ? el('span', { class: 'badge', text: '★ Watchlist' }) : null]),
      el('div', { class: 'sub', text: r.slug + ' · ' + (r.category || 'Other') + ' · ' + r.chains.join(', ') + ' · tracked since ' + (r.listed_at || 'unknown') }),
      el('div', { class: 'facts' }, [
        el('div', {}, [el('span', { text: 'Implied value' }), el('b', { text: fmtUsdFull(r.implied_value_usd) })]),
        el('div', {}, [el('span', { text: 'Range (½× – 2×)' }), el('b', { text: fmtUsd(r.implied_low_usd) + ' – ' + fmtUsd(r.implied_high_usd) })]),
        el('div', {}, [el('span', { text: 'TVL' }), el('b', { text: fmtUsdFull(r.tvl_usd) })]),
        el('div', {}, [el('span', { text: '7-day change' }), el('b', { text: fmtPct(r.change_7d) })]),
        el('div', {}, [el('span', { text: 'Age without a token' }), el('b', { text: fmtAge(r.age_days) })]),
        el('div', {}, [el('span', { text: 'Readiness' }), el('b', { text: r.readiness + ' / 100' })]),
        el('div', {}, [el('span', { text: 'Farm position' }), el('b', { text: '$' + r.farm_capital_usd + ' · ' + r.farm_hold_days + ' days' })]),
        el('div', {}, [el('span', { text: 'Multiple' }), el('b', { text: r.fitted_multiple.toFixed(2) + '× (' + r.comps + ' comps)' })]),
      ]),
      el('div', { class: 'rangebar' }, [
        el('div', { class: 'track' }, [el('div', { class: 'fill' }), el('div', { class: 'mark' })]),
        el('div', { class: 'labels' }, [el('span', { text: fmtUsd(r.implied_low_usd) }), el('span', { text: 'implied ' + fmtUsd(r.implied_value_usd) }), el('span', { text: fmtUsd(r.implied_high_usd) })]),
      ]),
      el('div', { class: 'math' }, [el('b', { text: 'How the value is built: ' }), el('code', { text: math })]),
      el('h3', { text: 'Farm plan — six steps' }),
      el('ol', { class: 'steps' }, steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { class: 'totals', text: 'Plan totals: $' + r.farm_capital_usd + ' of capital, about $' + gas + ' of gas across the plan, ' + r.farm_hold_days + ' days from first deposit to unwind. Gas is a plain fee table by chain, not a live quote. Netted at the low end of the band (' + fmtUsd(r.implied_low_usd) + '), the plan is worth ' + fmtUsdFull(r.farm_net_low_usd) + ' after the capital and the gas are paid — every row on this board nets positive there, because the smallest low end on the board is still orders of magnitude above a $75–$200 position.' }),
      el('p', { class: 'note', text: 'This protocol records no token in the snapshot. That is not proof it has none: a token the snapshot does not carry would still be missing from this board.' }),
      el('button', { class: 'close', type: 'button', text: 'Close detail', onclick: closeDetail }),
    ]);
  }

  function setAsideSection() {
    if (!DATA.set_aside || DATA.set_aside.length === 0) return null;
    var head = el('tr', {}, [
      el('th', { text: 'Protocol' }), el('th', { text: 'Category' }),
      el('th', { class: 'num', text: 'TVL' }), el('th', { text: 'Why it is not ranked' }),
    ]);
    var body = el('tbody', {});
    DATA.set_aside.forEach(function (r) {
      body.appendChild(el('tr', {}, [
        el('td', {}, [document.createTextNode(r.name + ' '), el('span', { class: 'slug', text: r.slug })]),
        el('td', { text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { text: r.reason }),
      ]));
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'Set aside — not ranked' }),
      el('p', { text: 'These protocols record no token either, but they are wrapped, staked or bridged products of a token that already trades — WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in Binance’s staking product — so they are not protocols still waiting on a launch of their own. ' + DATA.set_aside_size + ' such products are set aside in all; the 12 biggest are shown.' }),
      el('table', {}, [el('thead', {}, head), body]),
    ]);
  }

  function researchNote() {
    var top = DATA.rows.slice(0, 3);
    var ready = DATA.rows.slice().sort(function (a, b) { return b.readiness - a.readiness || b.implied_value_usd - a.implied_value_usd; }).slice(0, 3);
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    var f = DATA.fit, b = DATA.backtest;
    return el('section', { class: 'section' }, [
      el('h2', { text: 'What the radar found' }),
      el('p', { text: 'The board holds ' + DATA.board_size + ' pre-token protocols worth ' + fmtUsd(total) + ' at the model’s prices. The top of it is ' + top[0].name + ' at ' + fmtUsd(top[0].implied_value_usd) + ', then ' + top[1].name + ' at ' + fmtUsd(top[1].implied_value_usd) + ' and ' + top[2].name + ' at ' + fmtUsd(top[2].implied_value_usd) + '. All three are big, old and growing, which is what the model pays for: size sets the value, and age without a token and a rising TVL raise it. None of the three is a surprise name, and that is the point — a radar that only found obscurities would be finding noise.' }),
      el('p', { text: 'The pricing itself is deliberately unambitious. The fitted curve across the ' + f.comps + ' traded protocols, log10(market cap) = ' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' × log10(TVL), has an R² of ' + f.r_squared.toFixed(2) + '. Size explains about a fifth of what a token is worth; the rest is the category, the team, the market, things a snapshot cannot see. So the curve prices, but each category shifts it by its own intercept — and the board total is about half what a category-median board would claim, because the curve refuses to pay the biggest protocols their median multiple. The top rows sit near the 0.05 floor and the dashboard says so instead of dressing it up.' }),
      el('p', { text: 'The backtest is where the honesty lives. Pricing each traded protocol while hiding it from the fit gives a median error of ' + b.median_abs_pct + '%, and ' + b.within_2x_pct + '% land within double or half of the market’s own value — but only ' + b.within_2x_sym_pct + '% land inside a symmetric ±2× band, and that is the number to trust, because the one-sided count lets a wild underestimate pass. The curve was also tested blind: an 80/20 holdout repeated ' + b.blind_holdout.reps + ' times gives a median error of ' + b.blind_holdout.median_abs_pct + '%, and fitting on old listings to price new ones gives ' + b.time_split.map(function (t) { return t.cutoff + ' ' + t.median_abs_pct + '%'; }).join(', ') + '. Refitting on 200 resamples of the comparables moves the top implied values by p90/p10 ratios of ' + b.bootstrap.map(function (t) { return (t.p90_usd / t.p10_usd).toFixed(2) + '×'; }).join(', ') + '. That is why every row carries a range instead of a single confident number: read the range, not the point. A protocol whose range still clears the rest of the board is worth farming; one whose point value only looks good is not.' }),
      el('p', { text: 'If you farm one thing this week, farm for readiness, not for size: ' + ready[0].name + ' (' + ready[0].readiness + '/100, ' + fmtUsd(ready[0].implied_value_usd) + ' implied), ' + ready[1].name + ' (' + ready[1].readiness + '/100) and ' + ready[2].name + ' (' + ready[2].readiness + '/100) combine a rising TVL, a long run with no token and several live chains. Each farm plan names its capital, its gas by chain and its holding period up front, so the cost of the position is visible before the first transaction.' }),
      el('p', { text: 'The risks, plainly: “records no token” is not proof of no token, and a token may never come at all — the implied value is this radar’s own claim about what a launch would be worth, not a promise. Never pay anyone to claim an airdrop, never connect a wallet that holds funds you cannot lose, and keep the farming capital small: the plans here use $75–$200 a protocol, which is the most this board ever asks of a wallet.' }),
    ]);
  }

  function method() {
    var m = DATA.model, f = DATA.fit, b = DATA.backtest;
    var cats = DATA.categories.slice(0, 12);
    var head = el('tr', {}, [
      el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Comparables' }),
      el('th', { class: 'num', text: 'Median multiple' }), el('th', { class: 'num', text: 'Median TVL' }), el('th', { class: 'num', text: 'Curve intercept' }),
    ]);
    var body = el('tbody', {});
    cats.forEach(function (c) {
      body.appendChild(el('tr', {}, [
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: c.median_multiple.toFixed(2) + '×' }),
        el('td', { class: 'num', text: fmtUsd(c.median_tvl_usd) }),
        el('td', { class: 'num', text: c.intercept === null ? '—' : c.intercept.toFixed(2) }),
      ]));
    });
    return el('section', { class: 'section' }, [
      el('h2', { text: 'How the radar works' }),
      el('p', { html: 'Implied value = <code>TVL × fitted multiple × growth × maturity × breadth</code>. The fitted multiple comes from the size curve: log10(market cap) = intercept + ' + f.slope.toFixed(2) + ' × log10(TVL), where the intercept is the category’s own (the median log residual of its traded comparables, shrunk toward the global intercept with weight n/(n+' + m.shrink_k + '); categories with fewer than ' + m.min_comps + ' comparables use the global intercept), clamped to ' + m.mult_min + '–' + m.mult_max + '. The category median (global ' + DATA.global_multiple.toFixed(2) + '×) is kept as the reference the curve is measured against, not as the pricer. Growth is the 7-day TVL change clamped to ' + m.growth_floor + '…+' + m.growth_cap + '% and weighted ' + m.growth_weight + '. Maturity runs ' + m.maturity_floor + '–' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days + ' days without a token (' + m.unknown_age_days + ' days when the listing date is unknown). Breadth adds ' + m.breadth_step + ' per extra chain, up to ' + m.breadth_max_extra + ' extra chains. Readiness is 100 × (0.40 × growth + 0.35 × maturity + 0.25 × breadth). No protocol name is ever special-cased.' }),
      el('p', { text: 'The curve is log10(market cap) = ' + f.intercept.toFixed(2) + ' + ' + f.slope.toFixed(2) + ' × log10(TVL), fitted over ' + f.comps + ' traded protocols with R² ' + f.r_squared.toFixed(2) + ' and a residual spread of ' + f.resid_sd_dex.toFixed(2) + ' dex. The backtest hides each traded protocol from the fit in turn and prices it: median error ' + b.median_abs_pct + '%, ' + b.within_2x_pct + '% within 2× one-sided, ' + b.within_1_5x_pct + '% within 1.5× one-sided, ' + b.within_2x_sym_pct + '% inside a symmetric ±2× band, median |log10| error ' + b.median_log10 + '. The blind holdout (80/20, ' + b.blind_holdout.reps + ' repeats, fixed seed) gives ' + b.blind_holdout.median_abs_pct + '% median error; the time split gives ' + b.time_split.map(function (t) { return t.cutoff + ' ' + t.median_abs_pct + '% (' + t.train + ' train / ' + t.test + ' test)'; }).join(', ') + '. The range on every row is that backtest, stated per protocol.' }),
      el('table', {}, [el('thead', {}, head), body]),
      el('p', { class: 'note', text: 'The twelve biggest comparable categories. “Curve intercept” is the category’s shrunk intercept on the size curve: higher means the category’s tokens trade richer against TVL than the global curve says. “—” means the category is too thin for its own intercept and uses the global curve.' }),
      el('p', { text: 'The watchlist is the floor, never the ceiling: the 40 protocols at or above $50M with no token recorded, minus wrapped, staked and bridged products. The board adds every other pre-token protocol it can rank, so the radar also finds the early ones below the floor. Wrapped, staked and bridged products are set aside, never ranked, and the live-token protocols are shown apart with the market’s own values.' }),
      el('p', { text: 'What this radar does not do: it does not predict whether or when a protocol issues a token. The implied value is the entry’s own claim about what a launch would be worth if the protocol’s record stayed as it is.' }),
    ]);
  }

  function render() {
    var root = document.getElementById('board');
    root.setAttribute('aria-busy', 'false');
    root.textContent = '';
    root.appendChild(header());
    var chart = fitChart();
    if (chart) root.appendChild(chart);
    root.appendChild(controls());
    var d = detailCard();
    if (d) root.appendChild(d);
    root.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      root.appendChild(researchNote());
      var s = setAsideSection(); if (s) root.appendChild(s);
    }
    root.appendChild(method());
    root.appendChild(el('footer', {}, [
      el('p', { text: 'Data: DefiLlama protocols snapshot, as of ' + DATA.as_of + '. ' + DATA.source }),
      el('p', { text: 'Token Radar, model ' + DATA.model_version + '. Implied values are this entry’s own model, not a market price, and not investment advice.' }),
    ]));
  }

  function init() {
    if (!DATA) {
      document.getElementById('board').textContent = 'Token Radar: no data. The dashboard needs its data.js beside it.';
      return;
    }
    readHash();
    window.addEventListener('hashchange', function () { readHash(); render(); });
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
