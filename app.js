/* Control Hogar — app v1.0 (Etapa 3): inicio de sesión, resumen del mes, registro de gastos y sueldos. */
(function () {
  'use strict';

  var CFG = window.CONTROL_HOGAR;
  var CLAVE_SESION = 'ch_sesion';
  var CLAVE_LOGIN = 'ch_login';
  var VERSION = '1.0.0';

  var st = { sesion: null, usuario: null, config: null, resumen: null, recientes: [] };
  var $ = function (id) { return document.getElementById(id); };

  // ───────────────────────── Utilidades ─────────────────────────
  var fmtCOP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
  function pesos(n) { return fmtCOP.format(Math.round(n || 0)).replace(/\s/g, ' '); }
  function pesosCorto(n) {
    var a = Math.abs(n || 0), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + '$' + (a / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 2 }) + ' M';
    return pesos(n);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: CFG.ZONA }); }
  function fechaCorta(iso) {
    var p = String(iso).split('-');
    var meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return p.length === 3 ? Number(p[2]) + ' ' + meses[Number(p[1]) - 1] : iso;
  }
  function tituloMes(clave) {
    var p = String(clave || '').split('_');
    return p[0] ? p[0].charAt(0) + p[0].slice(1).toLowerCase() + ' ' + p[1] : '';
  }
  function soloDigitos(s) { return String(s).replace(/\D/g, '').replace(/^0+/, ''); }
  function nuevoId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  function aleatorio() {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function leerJwt(t) {
    try {
      var b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }
  function guardar(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  function leer(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function vista(id) {
    ['v-cargando', 'v-login', 'v-inicio'].forEach(function (v) { $(v).hidden = v !== id; });
  }

  // ───────────────────────── API ─────────────────────────
  function api(accion, datos, extra) {
    var cuerpo = Object.assign({ accion: accion, token: st.sesion, datos: datos || {} }, extra || {});
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita la verificación previa CORS
      body: JSON.stringify(cuerpo),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw Object.assign(new Error('El servidor no respondió (' + r.status + ').'), { codigo: 'RED' });
      return r.json();
    }, function () {
      throw Object.assign(new Error('Sin conexión. Revisa tu internet e intenta de nuevo.'), { codigo: 'RED' });
    }).then(function (j) {
      if (!j.ok) {
        if (j.codigo === 'NO_AUTENTICADO' || j.codigo === 'NO_AUTORIZADO') cerrarSesion(j.error);
        throw Object.assign(new Error(j.error || 'Error desconocido.'), { codigo: j.codigo });
      }
      return j;
    });
  }

  // ───────────────────────── Sesión ─────────────────────────
  function iniciarLoginGoogle() {
    var estado = aleatorio(), nonce = aleatorio();
    guardar(CLAVE_LOGIN, { estado: estado, nonce: nonce, t: Date.now() });
    var url = location.origin + location.pathname;
    var q = new URLSearchParams({
      client_id: CFG.CLIENT_ID,
      redirect_uri: url,
      response_type: 'id_token',
      scope: 'openid email',
      nonce: nonce,
      state: estado,
      prompt: 'select_account'
    });
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + q.toString());
  }

  /** Procesa la vuelta desde Google (#id_token=…). Devuelve una promesa o null si no aplica. */
  function procesarRetornoGoogle() {
    if (!location.hash || location.hash.length < 2) return null;
    var p = new URLSearchParams(location.hash.slice(1));
    if (!p.get('id_token') && !p.get('error')) return null;
    history.replaceState(null, '', location.pathname);
    var pendiente = leer(CLAVE_LOGIN); guardar(CLAVE_LOGIN, null);

    if (p.get('error')) return Promise.reject(new Error('Google canceló el inicio de sesión.'));
    if (!pendiente || pendiente.estado !== p.get('state') || Date.now() - pendiente.t > 600000) {
      return Promise.reject(new Error('El inicio de sesión expiró. Intenta de nuevo.'));
    }
    var idToken = p.get('id_token');
    var info = leerJwt(idToken);
    if (!info || info.nonce !== pendiente.nonce) return Promise.reject(new Error('Respuesta de Google no válida.'));

    return api('login', null, { idToken: idToken, token: null }).then(function (r) {
      st.sesion = r.sesion;
      guardar(CLAVE_SESION, { sesion: r.sesion, vence: r.vence, persona: r.usuario.persona });
    });
  }

  function cerrarSesion(mensaje) {
    st.sesion = null; guardar(CLAVE_SESION, null);
    mostrarLogin(mensaje);
  }

  function mostrarLogin(mensaje) {
    vista('v-login');
    var e = $('login-error');
    e.hidden = !mensaje; e.textContent = mensaje || '';
  }

  // ───────────────────────── Carga de datos ─────────────────────────
  function cargarTodo(silencioso) {
    var btn = $('btn-recargar'); btn.classList.add('girando');
    var pSesion = st.config ? Promise.resolve() : api('sesion').then(function (r) {
      st.usuario = r.usuario; st.config = r.config; st.mesActual = r.mesActual; st.meses = r.meses;
    });
    return pSesion.then(function () {
      return Promise.all([api('resumen', { mes: st.mesActual }).catch(function (e) {
        if (e.codigo === 'MES_NO_EXISTE') return api('resumen', {}); // mes aún sin bloque: muestra el último
        throw e;
      }), api('movimientos', { limite: 6 })]);
    }).then(function (rs) {
      st.resumen = rs[0].resumen;
      st.recientes = rs[1].movimientos;
      pintarInicio();
      vista('v-inicio');
    }).catch(function (e) {
      if (e.codigo === 'NO_AUTENTICADO' || e.codigo === 'NO_AUTORIZADO') return;
      if (!silencioso || !st.resumen) toast(e.message);
      if (!st.resumen) mostrarLogin(e.message);
    }).finally(function () { btn.classList.remove('girando'); });
  }

  // ───────────────────────── Pintar inicio ─────────────────────────
  var CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function pintarInicio() {
    var r = st.resumen, u = st.usuario;
    $('saludo').textContent = 'Hola, ' + u.persona;
    $('btn-perfil').textContent = u.persona.charAt(0).toUpperCase();
    $('titulo-mes').textContent = tituloMes(r.mes);

    var t = r.totales;
    var pendiente = r.rubros.reduce(function (s, x) { return s + Math.max(x.estimado - x.pagado, 0); }, 0);
    $('k-pendiente').textContent = pesos(pendiente);
    $('k-presupuesto').textContent = pesosCorto(t.estimado);
    $('k-pagado').textContent = pesosCorto(t.pagado);
    $('k-ingresos').textContent = pesosCorto(r.totalIngresos);
    var pct = t.estimado ? Math.min(100, Math.round(t.pagado / t.estimado * 100)) : 0;
    var barra = $('k-barra');
    barra.firstElementChild.style.width = pct + '%';
    barra.setAttribute('aria-valuenow', pct);

    // Aviso de sueldo pendiente
    var faltan = st.config.personas.filter(function (p) {
      var i = r.ingresos.filter(function (x) { return x.persona === p.persona; })[0];
      return !i || !i.valor;
    });
    var yo = faltan.filter(function (p) { return p.persona === u.persona; })[0];
    $('aviso-sueldo').innerHTML = (r.editable && faltan.length) ?
      '<div class="aviso"><p>' + (yo ? 'Registra tu sueldo de ' + esc(tituloMes(r.mes).split(' ')[0].toLowerCase()) + '.'
        : 'Falta el sueldo de ' + esc(faltan.map(function (p) { return p.persona; }).join(' y ')) + '.') +
      '</p><button type="button" id="btn-aviso-sueldo">Registrar</button></div>' : '';
    if ($('btn-aviso-sueldo')) $('btn-aviso-sueldo').onclick = function () { abrirSueldo(yo ? yo.persona : faltan[0].persona); };

    // Rubros
    $('lista-rubros').innerHTML = r.rubros.map(function (x) {
      var p = x.estimado ? Math.min(100, Math.round(x.pagado / x.estimado * 100)) : (x.pagado ? 100 : 0);
      var exced = x.pagado > x.estimado;
      return '<li><div class="nombre"><span class="estado ' + (x.pagoRealizado ? 'ok' : 'pend') + '">' +
        (x.pagoRealizado ? CHECK : '') + '</span><span>' + esc(x.nombre) + '</span></div>' +
        '<div class="valor">' + pesos(x.pagado) + '</div>' +
        '<div class="full"><div class="det">de ' + pesos(x.estimado) +
        (exced ? ' · excedido ' + pesos(x.pagado - x.estimado) : '') + '</div>' +
        '<div class="barra-progreso mini' + (exced ? ' excedido' : '') + '"><span style="width:' + p + '%"></span></div></div></li>';
    }).join('');

    // Aportes
    $('lista-aportes').innerHTML = r.aportes.map(function (a) {
      var saldo = Math.round(a.saldo);
      var cls = saldo < -1 ? 'debe' : 'aldia';
      var txt = saldo < -1 ? 'Le falta ' + pesos(-saldo) : (saldo > 1 ? 'A favor ' + pesos(saldo) : 'Al día');
      return '<article class="tarjeta aporte"><div class="quien"><span class="avatar">' + esc(a.persona.charAt(0)) + '</span>' +
        esc(a.persona) + '</div><p class="etiqueta">Aportó</p><p class="cifra">' + pesos(a.aporto) + '</p>' +
        '<p class="det sutil peque">de ' + pesos(a.aportar) + '</p><span class="saldo ' + cls + '">' + txt + '</span></article>';
    }).join('');

    // Movimientos recientes
    $('lista-movs').innerHTML = st.recientes.length ? st.recientes.map(function (m) {
      var ing = m.tipo === 'INGRESO';
      return '<li><div class="nombre"><span>' + esc(ing ? 'Sueldo' : m.rubro) + '</span></div>' +
        '<div class="valor">' + (ing ? '+' : '') + pesos(m.valor) + '</div>' +
        '<div class="det">' + esc(m.persona) + ' · ' + fechaCorta(m.fecha) + (m.descripcion ? ' · ' + esc(m.descripcion) : '') + '</div>' +
        '<div class="det der">' + esc(m.medio || '') + '</div></li>';
    }).join('') : '<li class="vacio">Aún no hay movimientos este mes.</li>';

    $('hora-act').textContent = 'actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    $('btn-gasto').hidden = !r.editable;
  }

  // ───────────────────────── Formularios ─────────────────────────
  function formatearMonto(input) {
    input.addEventListener('input', function () {
      var d = soloDigitos(input.value).slice(0, 10);
      input.value = d ? Number(d).toLocaleString('es-CO') : '';
    });
  }
  function valorMonto(input) { return Number(soloDigitos(input.value)) || 0; }

  function grupo(contenedor, opciones, seleccion, clase) {
    contenedor.innerHTML = opciones.map(function (o) {
      return '<button type="button" role="radio" class="' + (clase || '') + '" aria-checked="' + (o === seleccion) + '" data-v="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
    contenedor.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      Array.prototype.forEach.call(contenedor.children, function (x) { x.setAttribute('aria-checked', x === b); });
    };
  }
  function seleccionado(contenedor) {
    var b = contenedor.querySelector('[aria-checked="true"]');
    return b ? b.getAttribute('data-v') : '';
  }

  function abrirHoja(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
  function cerrarHoja(id) { $(id).hidden = true; document.body.style.overflow = ''; }

  function confirmar(titulo, mensaje) {
    return new Promise(function (resolve) {
      $('dlg-t').textContent = titulo; $('dlg-m').textContent = mensaje; $('dlg').hidden = false;
      $('dlg-si').onclick = function () { $('dlg').hidden = true; resolve(true); };
      $('dlg-no').onclick = function () { $('dlg').hidden = true; resolve(false); };
    });
  }

  function errorForm(id, msg) { var e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
  function ocupado(btn, si, texto) { btn.disabled = si; btn.textContent = si ? 'Guardando…' : texto; }

  // — Gasto —
  var borradorGasto = null; // conserva el ID para reintentos (no duplica)

  function abrirGasto() {
    var r = st.resumen;
    if (!r || !r.editable) return toast('Este mes es solo de consulta.');
    borradorGasto = { id: nuevoId() };
    $('f-gasto').reset();
    errorForm('g-error');
    grupo($('g-rubros'), r.rubros.map(function (x) { return x.nombre; }), '', 'chip');
    grupo($('g-persona'), st.config.personas.map(function (p) { return p.persona; }), st.usuario.persona);
    var medio = $('g-medio');
    medio.innerHTML = '<option value="">—</option>' + st.config.medios.map(function (m) {
      return '<option>' + esc(m) + '</option>';
    }).join('');
    var p = r.mes.split('_'), mesNum = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
      'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'].indexOf(p[0]) + 1;
    var f = $('g-fecha');
    f.min = p[1] + '-' + ('0' + mesNum).slice(-2) + '-01';
    f.max = hoy();
    f.value = hoy() >= f.min ? hoy() : f.min;
    abrirHoja('h-gasto');
    setTimeout(function () { $('g-valor').focus(); }, 280);
  }

  function guardarGasto(e, forzar) {
    if (e) e.preventDefault();
    var datos = {
      id: borradorGasto.id, tipo: 'GASTO',
      valor: valorMonto($('g-valor')),
      rubro: seleccionado($('g-rubros')),
      persona: seleccionado($('g-persona')),
      fecha: $('g-fecha').value,
      medio: $('g-medio').value,
      descripcion: $('g-desc').value.trim(),
      forzar: !!forzar
    };
    if (!datos.valor) return errorForm('g-error', 'Escribe el valor del gasto.');
    if (!datos.rubro) return errorForm('g-error', 'Elige el rubro.');
    if (!datos.fecha) return errorForm('g-error', 'Elige la fecha.');
    errorForm('g-error');
    var btn = $('g-guardar'); ocupado(btn, true);

    api('crear', datos).then(function (r) {
      if (r.requiereConfirmacion) {
        ocupado(btn, false, 'Guardar gasto');
        return confirmar('¿Es otro gasto?', r.mensaje).then(function (si) { if (si) guardarGasto(null, true); });
      }
      ocupado(btn, false, 'Guardar gasto');
      cerrarHoja('h-gasto');
      toast(r.duplicadoIgnorado ? 'Ese gasto ya estaba guardado.' : 'Gasto guardado ✓');
      if (r.resumen) st.resumen = r.resumen;
      return cargarTodo(true);
    }).catch(function (err) {
      ocupado(btn, false, err.codigo === 'RED' ? 'Reintentar' : 'Guardar gasto');
      errorForm('g-error', err.message);
    });
  }

  // — Sueldo —
  var borradorSueldo = null;

  function abrirSueldo(persona) {
    var r = st.resumen;
    borradorSueldo = { id: nuevoId() };
    $('f-sueldo').reset();
    errorForm('s-error');
    $('s-titulo').textContent = 'Sueldo de ' + tituloMes(r.mes).split(' ')[0].toLowerCase();
    grupo($('s-persona'), st.config.personas.map(function (p) { return p.persona; }), persona || st.usuario.persona);
    abrirHoja('h-sueldo');
    setTimeout(function () { $('s-valor').focus(); }, 280);
  }

  function guardarSueldo(e) {
    e.preventDefault();
    var r = st.resumen;
    var datos = {
      id: borradorSueldo.id, tipo: 'INGRESO',
      valor: valorMonto($('s-valor')),
      persona: seleccionado($('s-persona')),
      // El sueldo se registra en el mes que se está viendo: hoy si es ese mes, si no el día 1.
      fecha: fechaInicioMes(r.mes) <= hoy() && hoy() <= finMes(r.mes) ? hoy() : fechaInicioMes(r.mes),
      descripcion: 'Sueldo mensual'
    };
    if (!datos.valor) return errorForm('s-error', 'Escribe el valor del sueldo.');
    errorForm('s-error');
    var btn = $('s-guardar'); ocupado(btn, true);
    api('crear', datos).then(function (res) {
      ocupado(btn, false, 'Guardar sueldo');
      cerrarHoja('h-sueldo');
      toast(res.duplicadoIgnorado ? 'Ese sueldo ya estaba guardado.' : 'Sueldo guardado ✓');
      return cargarTodo(true);
    }).catch(function (err) {
      ocupado(btn, false, err.codigo === 'RED' ? 'Reintentar' : 'Guardar sueldo');
      errorForm('s-error', err.message);
    });
  }

  var MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  function fechaInicioMes(clave) {
    var p = clave.split('_'); return p[1] + '-' + ('0' + (MESES.indexOf(p[0]) + 1)).slice(-2) + '-01';
  }
  function finMes(clave) {
    var p = clave.split('_'), m = MESES.indexOf(p[0]) + 1;
    var d = new Date(Number(p[1]), m, 0).getDate();
    return p[1] + '-' + ('0' + m).slice(-2) + '-' + d;
  }

  // ───────────────────────── Eventos ─────────────────────────
  function enlazar() {
    $('btn-google').onclick = iniciarLoginGoogle;
    $('btn-recargar').onclick = function () { cargarTodo(); };
    $('btn-gasto').onclick = abrirGasto;
    $('f-gasto').addEventListener('submit', guardarGasto);
    $('f-sueldo').addEventListener('submit', guardarSueldo);
    formatearMonto($('g-valor'));
    formatearMonto($('s-valor'));
    $('btn-perfil').onclick = function () {
      confirmar('Cerrar sesión', 'Estás como ' + (st.usuario ? st.usuario.persona + ' (' + st.usuario.email + ')' : '') +
        '. ¿Quieres cerrar la sesión en este celular?').then(function (si) { if (si) cerrarSesion(); });
      $('dlg-si').textContent = 'Cerrar sesión';
    };
    document.querySelectorAll('[data-cerrar]').forEach(function (b) {
      b.onclick = function () { cerrarHoja(b.closest('.hoja-fondo').id); };
    });
    document.querySelectorAll('.hoja-fondo').forEach(function (f) {
      f.addEventListener('click', function (e) { if (e.target === f) cerrarHoja(f.id); });
    });
    // Al volver a la app después de un rato, refresca en silencio
    var oculto = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) oculto = Date.now();
      else if (st.sesion && st.resumen && Date.now() - oculto > 60000) cargarTodo(true);
    });
    // Restablece el texto del botón del diálogo para usos normales
    $('dlg-no').addEventListener('click', function () { $('dlg-si').textContent = 'Sí, guardar'; });
    $('dlg-si').addEventListener('click', function () { setTimeout(function () { $('dlg-si').textContent = 'Sí, guardar'; }, 0); });
  }

  // ───────────────────────── Arranque ─────────────────────────
  function arrancar() {
    enlazar();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
    }
    var retorno = procesarRetornoGoogle();
    (retorno || Promise.resolve()).then(function () {
      var s = leer(CLAVE_SESION);
      if (!s || !s.sesion || s.vence < Date.now()) { guardar(CLAVE_SESION, null); return mostrarLogin(); }
      st.sesion = s.sesion;
      return cargarTodo();
    }).catch(function (e) { mostrarLogin(e.message); });
  }

  window.ControlHogar = { version: VERSION };
  arrancar();
})();
