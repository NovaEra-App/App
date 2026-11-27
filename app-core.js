// =========================================================================
// NOVA ERA v10.0 — MÓDULO CORE (AUTH, CACHE 5s, CHECK-IN, CRONOGRAMA, UI)
// =========================================================================
const SUPABASE_URL = "https://vocrljiimyknofyhdatg.supabase.co";
const SUPABASE_KEY = "sb_publishable_o0WnhKjaTBmvfO7Joh6QJA_VzzW_2Zc";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

window.usuarioLogado = null;
window.clientesDB = [];
window.colaboradoresTodosDB = [];
window.cronogramaTodosDB = [];
window.execucoesMesDB = [];
window.execucoesHistorico60dDB = [];
window.presencasRecentesDB = [];
window.areasClienteDB = [];
window.especiesClienteDB = [];
window.pedidosSuprimentosDB = [];
window.feriadosDB = [];
window.obsRapidasDB = [];
window.catalogoSuprimentosDB = [];
window.tiposAtividadeDB = [];
window.listasSistemaDB = [];
window.regrasDependenciaDB = [];
window.presencaHojeDB = null;

window.agendaMesAtual = {};
window.agendaCalendario = {};
window.gruposPendentesCache = [];
window.lotesAtivosCache = [];
window.lotesResolvidosCache = [];
window.especiesPodaMesCache = [];
window.fotosZoomCache = [];
window.motivosDispensaCache = [];

let clienteAtivo = localStorage.getItem('novaera_cliente_ativo') || '';
let equipeLogada = [];
let hashesConhecidos = new Set(JSON.parse(localStorage.getItem('novaera_hashes_fotos') || '[]'));

let filtroTarefasHoje = 'PENDENTES';
let filtroTipoAtividadeHoje = 'TODOS';
let modoChuvaAtivo = false;
let canalChatAtivo = 'EQUIPE';
let tabAtual = 'hoje';
let gpsAtual = { lat: null, lng: null, acc: null, distCliente: null, suspeitoFake: false };
let suprimentosInicializado = false;
let ciclosVerificadosPorCliente = {};
let gpsMonitorIniciado = false;

let calAnoAtivo = new Date().getFullYear();
let calMesAtivo = new Date().getMonth();
let execucoesCalendarioCache = [];

// =========================================================================
// 1. UTILITÁRIOS E IDENTIDADE / PROPRIEDADE DE TAREFA
// =========================================================================
function initIcons() { try { if (typeof lucide !== 'undefined') lucide.createIcons(); } catch (e) {} }
function dataISO(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function normalizarTexto(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function formatarMinutosStr(min) {
  const mTotal = Math.max(1, Math.round(Number(min) || 0));
  const h = Math.floor(mTotal / 60), m = mTotal % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
function extrairListaFotos(campoUrl) {
  if (!campoUrl) return [];
  return String(campoUrl).split('|').map(s => s.trim()).filter(Boolean);
}
function registrarFotoZoom(url, legenda) {
  const idx = window.fotosZoomCache.length;
  window.fotosZoomCache.push({ url, legenda });
  return idx;
}
function abrirZoomFotoByIdx(idx) {
  const item = window.fotosZoomCache[idx];
  if (!item || !item.url) return;
  document.getElementById('lightbox-op-img').src = item.url;
  document.getElementById('lightbox-op-caption').textContent = item.legenda || '';
  document.getElementById('lightbox-op-modal').classList.remove('hidden');
}
function fecharZoomFotoOp() { document.getElementById('lightbox-op-modal').classList.add('hidden'); }

function souDonoTarefa(exec) {
  if (!exec || !window.usuarioLogado) return false;
  if (exec.responsavel_auth_id && window.usuarioLogado.auth_user_id) {
    return exec.responsavel_auth_id === window.usuarioLogado.auth_user_id;
  }
  return normalizarTexto(exec.registrado_por) === normalizarTexto(window.usuarioLogado.nome);
}

function obterParticipantesLista(exec) {
  return Array.isArray(exec?.participantes) ? exec.participantes : [];
}

function obterApoiosAtivos(exec) {
  return obterParticipantesLista(exec).filter(p => !p.fim);
}

function atualizarBadgeRede(isOnline, usouCache = false) {
  const badge = document.getElementById('net-badge');
  if (!badge) return;
  if (isOnline && !usouCache) {
    badge.textContent = "ONLINE";
    badge.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  } else {
    badge.textContent = isOnline ? "SINAL INSTÁVEL (CACHE)" : "SUBSOLO / OFFLINE";
    badge.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30";
  }
}

function ehFeriado(d) { return window.feriadosDB.includes(dataISO(d)); }
function diaUtil(d) { return d.getDay() !== 0 && d.getDay() !== 6 && !ehFeriado(d); }
function proximoDiaUtilISO(baseDate = new Date()) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  do { d.setDate(d.getDate() + 1); } while (!diaUtil(d));
  return dataISO(d);
}
function somarDiasCorridosEmpurrandoFDS(diasCorridos) {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Number(diasCorridos) || 0));
  while (!diaUtil(d)) d.setDate(d.getDate() + 1);
  return dataISO(d);
}
function ultimoDiaUtilAnteriorISO(refDate = new Date()) {
  const d = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  do { d.setDate(d.getDate() - 1); } while (!diaUtil(d));
  return dataISO(d);
}
function postoBloqueadoHoje() {
  const hoje = new Date();
  if (diaUtil(hoje)) return false;
  if (window.presencaHojeDB && ['PLANTAO_AUTORIZADO', 'AUTORIZADO_GESTAO', 'PLANTAO_ATIVO'].includes(window.presencaHojeDB.status_validacao || window.presencaHojeDB.modo_checkin)) return false;
  return true;
}

function execCorrespondeTarefa(e, t) {
  if (e.tarefa_id && t.id) return Number(e.tarefa_id) === Number(t.id);
  const espE = (e.especie || '').trim().toLowerCase();
  const espT = (t.especie || '').trim().toLowerCase();
  return e.setor === t.setor && e.atividade === t.atividade && (!espE || !espT || espE === espT);
}
function isFreqFlutuante(freqStr) {
  const f = (freqStr || '').toLowerCase();
  return f.includes('mês') || f.includes('mensal') || f.includes('quinzenal') || f.includes('quadrimestral');
}
function isFreqDiaria(freqStr) {
  const f = (freqStr || '').toLowerCase();
  return f.includes('diári') || f.includes('diari') || f.includes('seg a sex') || f.includes('5x');
}
function diaCorrespondeFrequencia(freqStr, diaSemana) {
  const f = (freqStr || '').toLowerCase();
  if (isFreqDiaria(f)) return diaSemana >= 1 && diaSemana <= 5;
  if (f.includes('3x/semana')) return diaSemana === 1 || diaSemana === 3 || diaSemana === 5;
  if (f.includes('2x/semana')) return diaSemana === 2 || diaSemana === 4;
  if (f.includes('seg') && diaSemana === 1) return true;
  if (f.includes('ter') && diaSemana === 2) return true;
  if (f.includes('qua') && diaSemana === 3) return true;
  if (f.includes('qui') && diaSemana === 4) return true;
  if (f.includes('sex') && diaSemana === 5) return true;
  return false;
}
function proximaOcorrenciaRecorrenteISO(freqStr, aPartirISO) {
  const d = new Date(aPartirISO + 'T12:00:00');
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() + 1);
    if (diaUtil(d) && diaCorrespondeFrequencia(freqStr, d.getDay())) return dataISO(d);
  }
  return null;
}
function atividadeCombinaComTipo(textoAtividade, tipoObj) {
  if (!tipoObj) return false;
  const normAtiv = normalizarTexto(textoAtividade);
  const palavras = String(tipoObj.palavras_chave || tipoObj.nome || '').split(',').map(p => normalizarTexto(p.trim())).filter(Boolean);
  return palavras.some(kw => normAtiv.includes(kw));
}
function obterListaSistema(grupo) {
  return window.listasSistemaDB.filter(l => l.grupo === grupo && l.ativo !== false);
}

// =========================================================================
// 2. MOTOR HÍBRIDO DE SLA E EXPIRAÇÃO DE CICLOS
// =========================================================================
function calcularDuracaoCalibradaTarefa(t) {
  const baseMin = Number(t.duracao_minutos) || 30;
  if (t.travar_sla_manual) return baseMin;

  const historicoValido = window.execucoesHistorico60dDB.filter(e =>
    e.cliente === clienteAtivo && e.status_execucao === 'CONCLUIDO' && !e.entrega_parcial &&
    execCorrespondeTarefa(e, t) && Number(e.duracao_real_min) >= 5 && Number(e.duracao_real_min) <= (baseMin * 3)
  );
  if (historicoValido.length >= 2) {
    const soma = historicoValido.reduce((acc, cur) => acc + Number(cur.duracao_real_min), 0);
    return Math.max(5, Math.ceil(((soma / historicoValido.length) * 1.20) / 5) * 5);
  }

  const espObj = window.especiesClienteDB.find(sp =>
    sp.cliente === clienteAtivo && sp.nome_area === t.setor &&
    t.especie && sp.especie.toLowerCase().includes(t.especie.toLowerCase())
  );
  if (espObj && Number(espObj.medida_valor) > 0 && Number(espObj.rendimento_hora) > 0 && (t.atividade.toLowerCase().includes('praga') || t.atividade.toLowerCase().includes('poda') || t.atividade.toLowerCase().includes('limpeza'))) {
    const minCalc = Math.ceil(((Number(espObj.medida_valor) / Number(espObj.rendimento_hora)) * 60) / 5) * 5;
    if (minCalc >= 10 && minCalc <= 480) return minCalc;
  }
  return baseMin;
}

async function sincronizarCiclosExpirados() {
  if (!navigator.onLine || !clienteAtivo || ciclosVerificadosPorCliente[clienteAtivo]) return;
  ciclosVerificadosPorCliente[clienteAtivo] = true;

  const hoje = new Date(), hojeStr = dataISO(hoje);
  const tarefasRec = window.cronogramaTodosDB.filter(t => t.cliente === clienteAtivo && t.ativo !== false && !t.data_alvo && !isFreqFlutuante(t.frequencia));
  if (tarefasRec.length === 0) return;

  const execsCli = window.execucoesHistorico60dDB.filter(e => e.cliente === clienteAtivo);
  const presencasDatas = new Set(window.presencasRecentesDB.filter(p => p.cliente === clienteAtivo && p.status_validacao !== 'AUTORIZADO_GESTAO').map(p => p.data_turno));
  const paraGravar = [];

  for (let offset = 7; offset >= 1; offset--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - offset);
    if (d.getMonth() !== hoje.getMonth() || !diaUtil(d)) continue;
    const dStr = dataISO(d);

    tarefasRec.forEach(t => {
      if (!diaCorrespondeFrequencia(t.frequencia, d.getDay())) return;
      if (execsCli.some(e => e.data_referencia === dStr && execCorrespondeTarefa(e, t))) return;

      const diaria = isFreqDiaria(t.frequencia), vital = Boolean(t.vital);
      if (vital && !diaria) {
        const proxISO = proximaOcorrenciaRecorrenteISO(t.frequencia, dStr);
        if (!proxISO || hojeStr < proxISO) return;
        const atendida = execsCli.some(e => e.data_referencia >= dStr && e.data_referencia < proxISO && ['CONCLUIDO', 'DISPENSADO', 'IMPEDIMENTO_EPI'].includes(e.status_execucao) && execCorrespondeTarefa(e, t));
        if (atendida) return;
      }

      const postoAtivoNaData = presencasDatas.has(dStr);
      paraGravar.push({
        tarefa_id: t.id, data_referencia: dStr, cliente: clienteAtivo, setor: t.setor,
        atividade: t.atividade, especie: t.especie || 'Geral',
        equipe_executora: 'Sistema (Ciclo Vencido)', registrado_por: 'Automático',
        observacao: postoAtivoNaData
          ? `Ciclo vencido (${vital ? 'Atividade Vital' : 'Rotina'}) — Posto ativo na data, tarefa não executada.`
          : `Ciclo vencido (${vital ? 'Atividade Vital' : 'Rotina'}) — Posto sem ativação na data.`,
        dh_inicio_tarefa: `${dStr}T17:00:00`, dh_envio_servidor: new Date().toISOString(),
        duracao_estimada_min: Number(t.duracao_minutos) || 30, duracao_real_min: 0,
        flag_auditoria: 'CICLO_PERDIDO', status_execucao: 'NAO_REALIZADA'
      });
    });
  }

  for (const reg of paraGravar) {
    try {
      const { data, error } = await sb.from('execucoes_auditoria').insert([reg]).select();
      if (!error && data?.[0]) {
        window.execucoesMesDB.push(data[0]);
        window.execucoesHistorico60dDB.push(data[0]);
      }
    } catch (e) {}
  }
}

// =========================================================================
// 3. SOM, NOTIFICAÇÕES E GPS
// =========================================================================
let audioCtxGlobal = null;
let mensagensNaoLidas = { EQUIPE: 0, SUPERVISAO: 0, CLIENTE: 0 };

function desbloquearAudioNotificacao() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtxGlobal) audioCtxGlobal = new AC();
    if (audioCtxGlobal.state === 'suspended') audioCtxGlobal.resume();
  } catch (e) {}
}

function tocarChimeNotificacao() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtxGlobal) audioCtxGlobal = new AC();
    if (audioCtxGlobal.state === 'suspended') audioCtxGlobal.resume();
    const osc = audioCtxGlobal.createOscillator(), gain = audioCtxGlobal.createGain();
    osc.connect(gain); gain.connect(audioCtxGlobal.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtxGlobal.currentTime);
    osc.frequency.setValueAtTime(880.00, audioCtxGlobal.currentTime + 0.12);
    gain.gain.setValueAtTime(0.22, audioCtxGlobal.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxGlobal.currentTime + 0.55);
    osc.start(audioCtxGlobal.currentTime); osc.stop(audioCtxGlobal.currentTime + 0.55);
  } catch (e) {}
}

function solicitarPermissaoNotificacoes() {
  desbloquearAudioNotificacao();
  if ("Notification" in window) {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') { tocarChimeNotificacao(); alert("🔔 Alertas sonoros e notificações ativados!"); }
    });
  }
}

function dispararNotificacaoVisual(autor, canal, texto, urgente) {
  const canalNomes = { EQUIPE: 'Equipe', SUPERVISAO: 'Supervisão', CLIENTE: 'Cliente' };
  const titulo = urgente ? `🚨 URGENTE • ${autor}` : `💬 ${autor} (${canalNomes[canal] || canal})`;
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    try { new Notification(titulo, { body: texto }); } catch (e) {}
  }
  mostrarToastFlutuante(titulo, texto, canal);
}

function mostrarToastFlutuante(titulo, texto, canal) {
  let toast = document.getElementById('toast-chat-alerta');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-chat-alerta';
    toast.className = 'fixed top-3 left-3 right-3 max-w-md mx-auto bg-slate-900/95 border border-orange-500/60 text-white p-3 rounded-2xl shadow-2xl z-50 flex items-center justify-between gap-2.5 transition-all duration-300 transform -translate-y-24 opacity-0 cursor-pointer';
    document.body.appendChild(toast);
  }
  toast.onclick = () => { toast.classList.add('-translate-y-24', 'opacity-0'); if (canal) { switchTab('chat'); selecionarCanalChat(canal); } };
  toast.innerHTML = `<div class="flex items-center gap-2.5 min-w-0"><div class="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center flex-shrink-0"><i data-lucide="bell-ring" class="w-4 h-4"></i></div><div class="truncate"><p class="text-[11px] font-extrabold text-orange-400 truncate">${titulo}</p><p class="text-xs text-slate-100 truncate">${texto}</p></div></div><span class="text-[10px] font-extrabold bg-orange-500 text-white px-2.5 py-1 rounded-lg flex-shrink-0">Ver</span>`;
  initIcons();
  toast.classList.remove('-translate-y-24', 'opacity-0'); toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => { toast.classList.add('-translate-y-24', 'opacity-0'); toast.classList.remove('translate-y-0', 'opacity-100'); }, 5000);
}

function atualizarBadgesNaoLidas() {
  const totalGeral = mensagensNaoLidas.EQUIPE + mensagensNaoLidas.SUPERVISAO + mensagensNaoLidas.CLIENTE;
  const dotApp = document.getElementById('chat-unread-dot');
  if (dotApp) {
    if (totalGeral > 0) { dotApp.classList.remove('hidden'); dotApp.textContent = totalGeral > 9 ? '9+' : totalGeral; }
    else dotApp.classList.add('hidden');
  }
  ['EQUIPE', 'SUPERVISAO', 'CLIENTE'].forEach(canal => {
    const btnCanal = document.getElementById(`btn-canal-${canal}`);
    if (btnCanal) {
      let badge = btnCanal.querySelector('.canal-badge-dot');
      if (mensagensNaoLidas[canal] > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'canal-badge-dot ml-1 px-1.5 py-0.2 bg-red-600 text-white text-[9px] font-extrabold rounded-full'; btnCanal.appendChild(badge); }
        badge.textContent = mensagensNaoLidas[canal];
      } else if (badge) badge.remove();
    }
  });
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371e3, p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function monitorarGPS() {
  if (gpsMonitorIniciado || !navigator.geolocation) return;
  gpsMonitorIniciado = true;
  let ultimaLat = null, ultimaLng = null;
  navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy, altitude } = pos.coords;
    let fakeDetectado = false;
    if (ultimaLat !== null && Math.abs(latitude - ultimaLat) + Math.abs(longitude - ultimaLng) === 0 && (accuracy === 1 || accuracy === 5 || altitude === 0)) fakeDetectado = true;
    ultimaLat = latitude; ultimaLng = longitude;
    gpsAtual = { ...gpsAtual, lat: latitude, lng: longitude, acc: Math.round(accuracy || 0), suspeitoFake: fakeDetectado };
    const cliAtualObj = window.clientesDB.find(c => c.nome === clienteAtivo);
    if (cliAtualObj) {
      const d = calcularDistanciaMetros(latitude, longitude, Number(cliAtualObj.latitude), Number(cliAtualObj.longitude));
      gpsAtual.distCliente = d;
      const corGps = d <= (Number(cliAtualObj.raio_metros) || 350) ? 'text-emerald-400' : 'text-amber-400';
      document.getElementById('gps-status-text').innerHTML = `<i data-lucide="locate-fixed" class="w-3 h-3 ${corGps}"></i> ${clienteAtivo} • a ${d}m (±${gpsAtual.acc}m)`;
      initIcons(); validarCheckinSubsoloPendente();
    }
  }, () => {
    document.getElementById('gps-status-text').innerHTML = `<i data-lucide="wifi-off" class="w-3 h-3 text-amber-400"></i> Modo Subsolo / Sem GPS`;
    initIcons();
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 });
}

// =========================================================================
// 4. CHECK-IN PERSISTIDO NO APARELHO E CONTROLE DE CHUVA
// =========================================================================
function calcularMinutosChuvaHoje() {
  if (!window.presencaHojeDB) return 0;
  let base = Number(window.presencaHojeDB.minutos_chuva_acumulados) || 0;
  if (window.presencaHojeDB.modo_chuva_ativo && window.presencaHojeDB.dh_inicio_chuva_atual) {
    base += Math.max(0, Math.round((Date.now() - new Date(window.presencaHojeDB.dh_inicio_chuva_atual).getTime()) / 60000));
  }
  return base;
}

function obterOperadoresAtivosAgoraNoPosto() {
  if (!window.presencaHojeDB || !Array.isArray(window.presencaHojeDB.disponibilidade_operadores)) {
    return window.usuarioLogado ? [window.usuarioLogado.nome] : [];
  }
  return window.presencaHojeDB.disponibilidade_operadores.filter(op => !op.fim).map(op => op.nome);
}

function usuarioEstaAtivoNoCheckin() {
  if (!window.usuarioLogado || !window.presencaHojeDB) return false;
  if (window.presencaHojeDB.status_validacao === 'TURNO_ENCERRADO' || window.presencaHojeDB.status_validacao === 'AUTORIZADO_GESTAO') return false;
  return obterOperadoresAtivosAgoraNoPosto().some(n => normalizarTexto(n) === normalizarTexto(window.usuarioLogado.nome));
}

function iniciarFluxoCheckinPosto() {
  if (postoBloqueadoHoje()) { alert("🔒 Operação bloqueada em finais de semana e feriados. Solicite liberação à Supervisão."); return; }
  executarCheckinPostoValidado();
}

async function executarCheckinPostoValidado() {
  if (!window.usuarioLogado) return;
  const cliObj = window.clientesDB.find(c => c.nome === clienteAtivo);
  const raioPermitido = (cliObj ? Number(cliObj.raio_metros) : 350) + 100;
  if (gpsAtual.lat !== null && gpsAtual.distCliente !== null && gpsAtual.distCliente > raioPermitido) {
    alert(`📍 Fora do Perímetro!\nGPS a ${gpsAtual.distCliente}m de ${clienteAtivo} (limite: ${raioPermitido}m).`);
    return;
  }

  const btn = document.getElementById('btn-checkin-action');
  btn.disabled = true; btn.textContent = "Ativando...";
  const hojeStr = dataISO(), agoraISO = new Date().toISOString();
  const meuNome = window.usuarioLogado.nome;
  const noSubsolo = !navigator.onLine || gpsAtual.lat === null;

  // Caso o posto já esteja aberto por outro colega, apenas adiciona a entrada do usuário logado
  if (window.presencaHojeDB && !['TURNO_ENCERRADO', 'AUTORIZADO_GESTAO'].includes(window.presencaHojeDB.status_validacao)) {
    const listaDisp = Array.isArray(window.presencaHojeDB.disponibilidade_operadores) ? [...window.presencaHojeDB.disponibilidade_operadores] : [];
    if (!listaDisp.some(op => normalizarTexto(op.nome) === normalizarTexto(meuNome) && !op.fim)) {
      listaDisp.push({ nome: meuNome, inicio: agoraISO, fim: null, motivo_saida: null });
    }
    const ativos = listaDisp.filter(o => !o.fim).map(o => o.nome);
    const upd = { disponibilidade_operadores: listaDisp, equipe_presente: ativos.join(', '), qtd_operadores: ativos.length };
    Object.assign(window.presencaHojeDB, upd);
    NovaEraOffline.saveCheckinLocal(clienteAtivo, hojeStr, window.presencaHojeDB);

    if (navigator.onLine && window.presencaHojeDB.id) {
      try { await sb.from('presenca_posto').update(upd).eq('id', window.presencaHojeDB.id); } catch (e) {}
    } else {
      await NovaEraOffline.enqueue({ tipo: 'CHECKIN_UPD', id: window.presencaHojeDB.id || null, cliente: clienteAtivo, data_turno: hojeStr, payload: upd });
      atualizarBotaoFilaOffline();
    }
    recalcularTudo();
    return;
  }

  const eraPlantao = window.presencaHojeDB && window.presencaHojeDB.status_validacao === 'AUTORIZADO_GESTAO';
  const registro = {
    data_turno: hojeStr, cliente: clienteAtivo, equipe_presente: meuNome,
    qtd_operadores: 1, ausencias_motivo: null,
    modo_checkin: eraPlantao ? 'PLANTAO_AUTORIZADO' : (noSubsolo ? 'SUBSOLO_OFFLINE' : 'SUPERFICIE_GPS'),
    status_validacao: eraPlantao ? 'PLANTAO_ATIVO' : (noSubsolo ? 'AGUARDANDO_VALIDACAO_SUPERFICIE' : 'VALIDADO'),
    dh_checkin_aparelho: agoraISO, dh_validacao_superficie: noSubsolo ? null : agoraISO,
    lat_validacao: gpsAtual.lat, lng_validacao: gpsAtual.lng, distancia_metros: gpsAtual.distCliente,
    modo_chuva_ativo: false, minutos_chuva_acumulados: 0,
    disponibilidade_operadores: [{ nome: meuNome, inicio: agoraISO, fim: null, motivo_saida: null }]
  };

  if (navigator.onLine) {
    try {
      await NovaEraOffline.withTimeout(sb.from('presenca_posto').delete().eq('data_turno', hojeStr).eq('cliente', clienteAtivo), 5000);
      const { data } = await NovaEraOffline.withTimeout(sb.from('presenca_posto').insert([registro]).select(), 5000);
      window.presencaHojeDB = data?.[0] || registro;
    } catch (e) {
      window.presencaHojeDB = registro;
      await NovaEraOffline.enqueue({ tipo: 'CHECKIN_NOVO', cliente: clienteAtivo, data_turno: hojeStr, payload: registro });
      atualizarBotaoFilaOffline();
    }
  } else {
    window.presencaHojeDB = registro;
    await NovaEraOffline.enqueue({ tipo: 'CHECKIN_NOVO', cliente: clienteAtivo, data_turno: hojeStr, payload: registro });
    atualizarBotaoFilaOffline();
  }

  NovaEraOffline.saveCheckinLocal(clienteAtivo, hojeStr, window.presencaHojeDB);
  recalcularTudo();
}

async function validarCheckinSubsoloPendente() {
  const salvo = window.presencaHojeDB;
  if (salvo && salvo.status_validacao === 'AGUARDANDO_VALIDACAO_SUPERFICIE' && gpsAtual.lat !== null && navigator.onLine) {
    const cliObj = window.clientesDB.find(c => c.nome === clienteAtivo);
    const raioPermitido = (cliObj ? Number(cliObj.raio_metros) : 350) + 150;
    salvo.status_validacao = (gpsAtual.distCliente !== null && gpsAtual.distCliente > raioPermitido) ? 'FORA_PERIMETRO' : (gpsAtual.suspeitoFake ? 'SINAL_GPS_ATIPICO' : 'VALIDADO');
    salvo.dh_validacao_superficie = new Date().toISOString();
    salvo.lat_validacao = gpsAtual.lat; salvo.lng_validacao = gpsAtual.lng; salvo.distancia_metros = gpsAtual.distCliente;
    NovaEraOffline.saveCheckinLocal(clienteAtivo, dataISO(), salvo);
    if (salvo.id) {
      try { await sb.from('presenca_posto').update(salvo).eq('id', salvo.id); } catch (e) {}
    }
    atualizarBannerCheckin();
  }
}

function abrirModalSaidaTurno() {
  const reg = window.presencaHojeDB;
  if (!reg) return;
  const listaDisp = Array.isArray(reg.disponibilidade_operadores) && reg.disponibilidade_operadores.length > 0
    ? reg.disponibilidade_operadores
    : [{ nome: window.usuarioLogado?.nome || 'Operador', inicio: reg.dh_checkin_aparelho, fim: null }];
  const ativos = listaDisp.filter(op => !op.fim), jaSairam = listaDisp.filter(op => op.fim);

  let html = ativos.map(op => {
    const hIni = new Date(op.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const minAteAgora = Math.max(1, Math.round((Date.now() - new Date(op.inicio).getTime()) / 60000));
    const souEu = normalizarTexto(op.nome) === normalizarTexto(window.usuarioLogado?.nome);
    return `<label class="flex items-center justify-between p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl cursor-pointer"><div class="flex items-center gap-2.5"><input type="checkbox" value="${op.nome}" ${souEu ? 'checked' : ''} class="w-4 h-4 text-orange-500 rounded"><div><p class="text-xs font-extrabold text-slate-900">${op.nome}${souEu ? ' (Você)' : ''}</p><p class="text-[10px] text-slate-600">Desde ${hIni} (${formatarMinutosStr(minAteAgora)})</p></div></div><span class="text-[10px] font-bold text-emerald-700">🟢 Ativo</span></label>`;
  }).join('');

  if (jaSairam.length > 0) {
    html += `<p class="text-[10px] font-bold text-slate-400 uppercase pt-1">Já encerraram hoje:</p>`;
    html += jaSairam.map(op => `<div class="p-2.5 bg-slate-100 rounded-xl text-[11px] text-slate-500 flex justify-between"><span><b>${op.nome}</b> (${new Date(op.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às ${new Date(op.fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})</span><span>${op.motivo_saida || 'Encerrado'}</span></div>`).join('');
  }
  document.getElementById('lista-operadores-saida').innerHTML = html;
  document.getElementById('saida-turno-modal').classList.remove('hidden');
  initIcons();
}

async function confirmarSaidaSelecionados() {
  const selecionadosSaida = Array.from(document.querySelectorAll('#lista-operadores-saida input:checked')).map(c => c.value);
  if (selecionadosSaida.length === 0) { alert("Marque ao menos um operador."); return; }
  const motivo = document.getElementById('select-motivo-saida-parcial').value || 'Fim de expediente normal';
  const agoraISO = new Date().toISOString(), reg = window.presencaHojeDB;
  let listaDisp = Array.isArray(reg.disponibilidade_operadores) && reg.disponibilidade_operadores.length > 0
    ? [...reg.disponibilidade_operadores]
    : [{ nome: window.usuarioLogado?.nome || 'Operador', inicio: reg.dh_checkin_aparelho, fim: null }];
  listaDisp = listaDisp.map(op => (!op.fim && selecionadosSaida.includes(op.nome)) ? { ...op, fim: agoraISO, motivo_saida: motivo } : op);
  const aindaAtivos = listaDisp.filter(op => !op.fim), todosEncerraram = aindaAtivos.length === 0;

  if (todosEncerraram) {
    const abertas = window.execucoesMesDB.filter(e => e.cliente === clienteAtivo && ['EM_ANDAMENTO', 'PAUSADO'].includes(e.status_execucao));
    if (abertas.length > 0 && !confirm(`Existem atividades em aberto. Confirmar encerramento total do posto hoje?`)) return;
  }

  const updatePayload = {
    disponibilidade_operadores: listaDisp,
    equipe_presente: todosEncerraram ? listaDisp.map(o => o.nome).join(', ') : aindaAtivos.map(o => o.nome).join(', '),
    qtd_operadores: aindaAtivos.length
  };
  if (todosEncerraram) {
    Object.assign(updatePayload, { status_validacao: 'TURNO_ENCERRADO', dh_checkout_posto: agoraISO, modo_chuva_ativo: false, minutos_chuva_acumulados: calcularMinutosChuvaHoje(), dh_inicio_chuva_atual: null });
    modoChuvaAtivo = false;
  }

  Object.assign(window.presencaHojeDB, updatePayload);
  NovaEraOffline.saveCheckinLocal(clienteAtivo, dataISO(), window.presencaHojeDB);

  if (navigator.onLine && reg.id) {
    try { await sb.from('presenca_posto').update(updatePayload).eq('id', reg.id); } catch (e) {}
  } else {
    await NovaEraOffline.enqueue({ tipo: 'CHECKIN_UPD', id: reg.id || null, cliente: clienteAtivo, data_turno: dataISO(), payload: updatePayload });
    atualizarBotaoFilaOffline();
  }
  document.getElementById('saida-turno-modal').classList.add('hidden');
  recalcularTudo();
}

async function toggleChuva() {
  modoChuvaAtivo = !modoChuvaAtivo;
  const agoraISO = new Date().toISOString();
  if (window.presencaHojeDB) {
    if (modoChuvaAtivo) { window.presencaHojeDB.modo_chuva_ativo = true; window.presencaHojeDB.dh_inicio_chuva_atual = agoraISO; }
    else { window.presencaHojeDB.minutos_chuva_acumulados = calcularMinutosChuvaHoje(); window.presencaHojeDB.modo_chuva_ativo = false; window.presencaHojeDB.dh_inicio_chuva_atual = null; }
    NovaEraOffline.saveCheckinLocal(clienteAtivo, dataISO(), window.presencaHojeDB);
    if (navigator.onLine && window.presencaHojeDB.id) {
      try {
        await sb.from('presenca_posto').update({
          modo_chuva_ativo: window.presencaHojeDB.modo_chuva_ativo,
          minutos_chuva_acumulados: window.presencaHojeDB.minutos_chuva_acumulados,
          dh_inicio_chuva_atual: window.presencaHojeDB.dh_inicio_chuva_atual
        }).eq('id', window.presencaHojeDB.id);
      } catch (e) {}
    }
  }
  atualizarVisualBotaoChuva(); recalcularTudo();
}

function atualizarVisualBotaoChuva() {
  const btn = document.getElementById('btn-chuva'), txt = document.getElementById('txt-chuva'), badge = document.getElementById('chuva-acumulada-badge'), minChuva = calcularMinutosChuvaHoje();
  if (modoChuvaAtivo) { btn.className = "bg-blue-600 text-white px-2.5 py-2 rounded-xl flex items-center gap-1 text-xs font-bold shadow-sm animate-pulse"; txt.textContent = "Chovendo"; }
  else { btn.className = "bg-slate-100 border border-slate-200 px-2.5 py-2 rounded-xl text-slate-600 flex items-center gap-1 text-xs font-bold"; txt.textContent = "Seco"; }
  if (minChuva > 0 || modoChuvaAtivo) { badge.classList.remove('hidden'); badge.textContent = `🌦️ Chuva: ${formatarMinutosStr(minChuva)}`; }
  else badge.classList.add('hidden');
}

function atualizarBannerCheckin() {
  const box = document.getElementById('checkin-banner'), title = document.getElementById('checkin-title'), sub = document.getElementById('checkin-subtitle');
  const btnIn = document.getElementById('btn-checkin-action'), btnOut = document.getElementById('btn-checkout-action'), iconBox = document.getElementById('checkin-icon-box'), fab = document.getElementById('fab-add');
  btnOut.classList.add('hidden');

  if (postoBloqueadoHoje()) {
    box.className = "lg:col-span-5 bg-slate-200/80 border border-slate-300 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-slate-300 text-slate-700 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="lock" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-slate-800 truncate"; title.textContent = "🔒 Posto Fechado (Fim de Semana / Feriado)";
    sub.className = "text-[11px] text-slate-500 truncate"; sub.textContent = "Ativação restrita à autorização da Supervisão";
    btnIn.classList.add('hidden'); if (fab) fab.classList.add('hidden'); initIcons(); return;
  }
  if (fab && tabAtual === 'hoje') fab.classList.remove('hidden');
  const reg = window.presencaHojeDB, meuNome = window.usuarioLogado?.nome || 'Operador';

  if (reg && reg.status_validacao === 'AUTORIZADO_GESTAO') {
    box.className = "lg:col-span-5 bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-amber-200 text-amber-800 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="unlock" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-slate-800 truncate"; title.textContent = "🔓 Plantão Autorizado";
    sub.className = "text-[11px] text-slate-600 truncate"; sub.textContent = `Operador: ${meuNome}`;
    btnIn.classList.remove('hidden'); btnIn.disabled = false; btnIn.textContent = "Ativar Plantão"; initIcons(); return;
  }
  if (!reg) {
    box.className = "lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="radio" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-slate-800 truncate"; title.textContent = "Posto Aguardando Ativação";
    sub.className = "text-[11px] text-slate-500 truncate"; sub.textContent = `Operador: ${meuNome}`;
    btnIn.classList.remove('hidden'); btnIn.disabled = false; btnIn.textContent = "Ativar Posto"; initIcons(); return;
  }

  const horaIn = new Date(reg.dh_checkin_aparelho).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (reg.status_validacao === 'TURNO_ENCERRADO') {
    const horaOut = reg.dh_checkout_posto ? new Date(reg.dh_checkout_posto).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    box.className = "lg:col-span-5 bg-slate-800 text-white border border-slate-700 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-slate-700 text-emerald-400 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="check-circle-2" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-white truncate"; title.textContent = `🏁 Encerrado (${horaIn} às ${horaOut})`;
    sub.className = "text-[11px] text-slate-300 truncate"; sub.textContent = `Equipe: ${reg.equipe_presente}`;
    btnIn.classList.add('hidden');
  } else if (!usuarioEstaAtivoNoCheckin()) {
    box.className = "lg:col-span-5 bg-emerald-50 border border-emerald-200 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-emerald-200 text-emerald-800 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="user-plus" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-slate-800 truncate"; title.textContent = `🟢 Posto Ativo (${reg.equipe_presente})`;
    sub.className = "text-[11px] text-slate-600 truncate"; sub.textContent = `Registre sua entrada no turno`;
    btnIn.classList.remove('hidden'); btnIn.disabled = false; btnIn.textContent = "Entrar no Turno";
  } else if (reg.status_validacao === 'AGUARDANDO_VALIDACAO_SUPERFICIE') {
    box.className = "lg:col-span-5 bg-amber-50 border border-amber-200 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-amber-200 text-amber-800 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="wifi-off" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-amber-950 truncate"; title.textContent = `⏳ Ativo no Subsolo desde ${horaIn}`;
    sub.className = "text-[11px] text-amber-800 truncate"; sub.textContent = `Presentes: ${reg.equipe_presente}`;
    btnIn.classList.add('hidden'); btnOut.classList.remove('hidden');
  } else {
    box.className = "lg:col-span-5 bg-emerald-50 border border-emerald-200 rounded-2xl p-3 shadow-sm flex items-center justify-between gap-2";
    iconBox.className = "w-9 h-9 rounded-xl bg-emerald-200 text-emerald-800 flex items-center justify-center flex-shrink-0";
    iconBox.innerHTML = `<i data-lucide="radio" class="w-5 h-5"></i>`;
    title.className = "text-xs font-bold text-slate-800 truncate"; title.textContent = `🟢 Posto Ativo desde ${horaIn}`;
    sub.className = "text-[11px] text-slate-600 truncate"; sub.textContent = `Presentes: ${reg.equipe_presente}`;
    btnIn.classList.add('hidden'); btnOut.classList.remove('hidden');
  }
  initIcons();
}

// =========================================================================
// 5. CARREGAMENTO SUPABASE COM CACHE-FIRST + TIMEOUT DE 5 SEGUNDOS
// =========================================================================
function aplicarSnapshotLocal(snapData) {
  if (!snapData) return;
  if (snapData.clientesDB) window.clientesDB = snapData.clientesDB;
  if (snapData.colaboradoresTodosDB) window.colaboradoresTodosDB = snapData.colaboradoresTodosDB;
  if (snapData.cronogramaTodosDB) window.cronogramaTodosDB = snapData.cronogramaTodosDB;
  if (snapData.execucoesHistorico60dDB) window.execucoesHistorico60dDB = snapData.execucoesHistorico60dDB;
  if (snapData.execucoesMesDB) window.execucoesMesDB = snapData.execucoesMesDB;
  if (snapData.presencasRecentesDB) window.presencasRecentesDB = snapData.presencasRecentesDB;
  if (snapData.areasClienteDB) window.areasClienteDB = snapData.areasClienteDB;
  if (snapData.especiesClienteDB) window.especiesClienteDB = snapData.especiesClienteDB;
  if (snapData.pedidosSuprimentosDB) window.pedidosSuprimentosDB = snapData.pedidosSuprimentosDB;
  if (snapData.feriadosDB) window.feriadosDB = snapData.feriadosDB;
  if (snapData.obsRapidasDB) window.obsRapidasDB = snapData.obsRapidasDB;
  if (snapData.catalogoSuprimentosDB) window.catalogoSuprimentosDB = snapData.catalogoSuprimentosDB;
  if (snapData.tiposAtividadeDB) window.tiposAtividadeDB = snapData.tiposAtividadeDB;
  if (snapData.listasSistemaDB) window.listasSistemaDB = snapData.listasSistemaDB;
  if (snapData.regrasDependenciaDB) window.regrasDependenciaDB = snapData.regrasDependenciaDB;
}

async function carregarDadosSupabase() {
  const hoje = new Date(), hojeStr = dataISO(hoje);

  // 1. Hidratação instantânea do cache local (evita tela branca/infinita no subsolo)
  const snap = NovaEraOffline.loadSnapshot(clienteAtivo || 'Miss Silvia');
  const checkinCache = NovaEraOffline.loadCheckinLocal(clienteAtivo || 'Miss Silvia', hojeStr);
  if (snap?.data) {
    aplicarSnapshotLocal(snap.data);
    if (checkinCache) window.presencaHojeDB = checkinCache;
    modoChuvaAtivo = Boolean(window.presencaHojeDB?.modo_chuva_ativo);
    popularMenusIniciais();
    atualizarVisualBotaoChuva();
    recalcularTudo();
    if (typeof renderizarSuprimentos === 'function') renderizarSuprimentos();
    document.getElementById('loader-tasks').classList.add('hidden');
  } else {
    document.getElementById('loader-tasks').classList.remove('hidden');
  }

  if (!navigator.onLine) {
    atualizarBadgeRede(false, true);
    document.getElementById('loader-tasks').classList.add('hidden');
    return;
  }

  try {
    const inicioMes = dataISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    const d60 = new Date(); d60.setDate(d60.getDate() - 60);
    const d10 = new Date(); d10.setDate(d10.getDate() - 10);

    const [resCli, resColab, resCrono, resExec60d, resFer, resObs, resCatSup, resTipos, resListas, resDep] = await NovaEraOffline.withTimeout(Promise.all([
      sb.from('clientes').select('*').eq('ativo', true).order('nome', { ascending: true }),
      sb.from('colaboradores').select('*').eq('ativo', true).order('nome', { ascending: true }),
      sb.from('cronograma_mestre').select('*').eq('ativo', true).order('prioridade', { ascending: true }),
      sb.from('execucoes_auditoria').select('*').gte('data_referencia', dataISO(d60)).order('dh_envio_servidor', { ascending: false }),
      sb.from('feriados_config').select('*'),
      sb.from('obs_rapidas').select('*').order('ordem', { ascending: true }),
      sb.from('catalogo_suprimentos').select('*').eq('ativo', true).order('ordem', { ascending: true }),
      sb.from('tipos_atividade').select('*').eq('ativo', true).order('ordem', { ascending: true }),
      sb.from('listas_sistema').select('*').eq('ativo', true).order('ordem', { ascending: true }),
      sb.from('regras_dependencia').select('*').eq('ativo', true)
    ]), 5000);

    if (resCli.data) window.clientesDB = resCli.data;
    if (!clienteAtivo || !window.clientesDB.some(c => c.nome === clienteAtivo)) {
      clienteAtivo = window.usuarioLogado?.cliente_padrao || window.clientesDB[0]?.nome || 'Miss Silvia';
      localStorage.setItem('novaera_cliente_ativo', clienteAtivo);
    }

    const [resPresRec, resAreas, resEsp, resSup] = await NovaEraOffline.withTimeout(Promise.all([
      sb.from('presenca_posto').select('*').eq('cliente', clienteAtivo).gte('data_turno', dataISO(d10)).order('dh_checkin_aparelho', { ascending: false }),
      sb.from('cliente_areas').select('*').eq('cliente', clienteAtivo).eq('ativo', true).order('nome_area', { ascending: true }),
      sb.from('cliente_especies').select('*').eq('cliente', clienteAtivo).eq('ativo', true),
      sb.from('pedidos_suprimentos').select('*').eq('cliente', clienteAtivo).order('criado_em', { ascending: false }).limit(40)
    ]), 5000);

    if (resColab.data) window.colaboradoresTodosDB = resColab.data;
    if (resCrono.data) window.cronogramaTodosDB = resCrono.data;
    if (resExec60d.data) {
      window.execucoesHistorico60dDB = resExec60d.data;
      window.execucoesMesDB = resExec60d.data.filter(e => e.data_referencia >= inicioMes);
      if (calAnoAtivo === hoje.getFullYear() && calMesAtivo === hoje.getMonth()) execucoesCalendarioCache = window.execucoesMesDB;
    }
    if (resFer.data) window.feriadosDB = resFer.data.map(f => f.data_feriado);
    if (resObs.data) window.obsRapidasDB = resObs.data;
    if (resCatSup.data) window.catalogoSuprimentosDB = resCatSup.data;
    if (resTipos.data) window.tiposAtividadeDB = resTipos.data;
    if (resListas.data) window.listasSistemaDB = resListas.data;
    if (resDep.data) window.regrasDependenciaDB = resDep.data;

    if (resAreas.data) window.areasClienteDB = resAreas.data;
    if (resEsp.data) window.especiesClienteDB = resEsp.data;
    if (resSup.data) window.pedidosSuprimentosDB = resSup.data;
    if (resPresRec.data) window.presencasRecentesDB = resPresRec.data;

    const presencaServidor = window.presencasRecentesDB.find(p => p.data_turno === hojeStr) || null;
    if (presencaServidor) {
      window.presencaHojeDB = presencaServidor;
      NovaEraOffline.saveCheckinLocal(clienteAtivo, hojeStr, presencaServidor);
    } else if (checkinCache) {
      window.presencaHojeDB = checkinCache;
    } else {
      window.presencaHojeDB = null;
    }
    modoChuvaAtivo = Boolean(window.presencaHojeDB?.modo_chuva_ativo);

    await sincronizarCiclosExpirados();

    // Salva snapshot limpo no aparelho
    NovaEraOffline.saveSnapshot(clienteAtivo, {
      clientesDB: window.clientesDB,
      colaboradoresTodosDB: window.colaboradoresTodosDB,
      cronogramaTodosDB: window.cronogramaTodosDB,
      execucoesHistorico60dDB: window.execucoesHistorico60dDB,
      execucoesMesDB: window.execucoesMesDB,
      presencasRecentesDB: window.presencasRecentesDB,
      areasClienteDB: window.areasClienteDB,
      especiesClienteDB: window.especiesClienteDB,
      pedidosSuprimentosDB: window.pedidosSuprimentosDB,
      feriadosDB: window.feriadosDB,
      obsRapidasDB: window.obsRapidasDB,
      catalogoSuprimentosDB: window.catalogoSuprimentosDB,
      tiposAtividadeDB: window.tiposAtividadeDB,
      listasSistemaDB: window.listasSistemaDB,
      regrasDependenciaDB: window.regrasDependenciaDB
    });

    atualizarBadgeRede(true, false);
    popularMenusIniciais();
    atualizarVisualBotaoChuva();
    recalcularTudo();
    if (typeof renderizarSuprimentos === 'function') renderizarSuprimentos();
    monitorarGPS();
    if (typeof iniciarRealtimeSupabase === 'function') iniciarRealtimeSupabase();
  } catch (err) {
    console.warn("Timeout/Offline — operando via cache local:", err?.message || err);
    atualizarBadgeRede(navigator.onLine, true);
    recalcularTudo();
  } finally {
    document.getElementById('loader-tasks').classList.add('hidden');
  }
}

function popularMenusIniciais() {
  const selPosto = document.getElementById('posto-trabalho');
  if (selPosto && window.clientesDB.length > 0) {
    selPosto.innerHTML = window.clientesDB.map(c => `<option value="${c.nome}" ${c.nome === clienteAtivo ? 'selected' : ''}>${c.nome}</option>`).join('');
  }

  if (window.usuarioLogado) {
    document.getElementById('header-team-text').textContent = window.usuarioLogado.nome.split(' ')[0];
    equipeLogada = [window.usuarioLogado.nome];
  }

  const chipsBox = document.getElementById('chips-obs-rapidas');
  if (chipsBox && window.obsRapidasDB.length > 0) {
    chipsBox.innerHTML = window.obsRapidasDB.map((o, i) => `<button type="button" onclick="aplicarChipObs(${i})" class="text-[10px] font-semibold bg-slate-100 hover:bg-orange-100 hover:text-orange-800 text-slate-700 px-2.5 py-1 rounded-lg border border-slate-200 transition-colors">${o.texto}</button>`).join('');
  }

  const pausas = obterListaSistema('MOTIVO_PAUSA');
  document.getElementById('select-motivo-pausa').innerHTML = pausas.map(p => `<option value="${p.texto}">${p.rotulo}</option>`).join('');

  const saidas = obterListaSistema('MOTIVO_SAIDA');
  document.getElementById('select-motivo-saida-parcial').innerHTML = saidas.map(s => `<option value="${s.texto}">${s.rotulo}</option>`).join('');

  const contingencias = obterListaSistema('MOTIVO_CONTINGENCIA');
  document.getElementById('select-contingencia').innerHTML = contingencias.map(c => `<option value="${c.texto}">${c.rotulo}</option>`).join('');

  window.motivosDispensaCache = obterListaSistema('MOTIVO_DISPENSA');
  document.getElementById('chips-skip-motivos').innerHTML = window.motivosDispensaCache.map((m, i) =>
    `<button type="button" onclick="aplicarMotivoSkipByIdx(${i})" class="text-[10px] font-bold bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 px-2.5 py-1.5 rounded-xl">${m.rotulo}</button>`
  ).join('');

  const itensImpedimento = window.catalogoSuprimentosDB.filter(i => i.exibir_em_impedimento || i.categoria === 'EPI');
  document.getElementById('select-epi-faltante').innerHTML =
    itensImpedimento.map(i => `<option value="${i.nome}">${i.categoria === 'EPI' ? '🦺' : '🛠️'} ${i.nome}</option>`).join('') +
    `<option value="__OUTRO__">📦 Outro EPI ou Equipamento (especificar abaixo)</option>`;

  const selTipoExtra = document.getElementById('select-modal-tipo-atividade');
  if (selTipoExtra) {
    selTipoExtra.innerHTML =
      window.tiposAtividadeDB.map(t => `<option value="${t.nome}">${t.icone || '🌿'} ${t.nome}</option>`).join('') +
      `<option value="__OUTRA__">➕ Outra atividade (digitar)</option>`;
  }

  const selSupArea = document.getElementById('sup-area-select'), areaAntes = selSupArea.value || 'Todo o Posto';
  const datalistSetores = document.getElementById('setores-list');
  if (window.areasClienteDB.length > 0) {
    selSupArea.innerHTML = `<option value="Todo o Posto">Todo o Posto</option>` + window.areasClienteDB.map(a => `<option value="${a.nome_area}">${a.nome_area}</option>`).join('');
    if ([...selSupArea.options].some(o => o.value === areaAntes)) selSupArea.value = areaAntes;
    datalistSetores.innerHTML = window.areasClienteDB.map(a => `<option value="${a.nome_area}">`).join('');
  }
  if (typeof selecionarCategoriaSup === 'function') {
    if (!suprimentosInicializado) { suprimentosInicializado = true; selecionarCategoriaSup('INSUMO'); }
    else selecionarCategoriaSup(typeof categoriaSuprimentoAtiva !== 'undefined' ? categoriaSuprimentoAtiva : 'INSUMO');
  }
}
function aplicarChipObs(idx) { if (window.obsRapidasDB[idx]) document.getElementById('obs-input').value = window.obsRapidasDB[idx].texto; }
function aplicarMotivoSkipByIdx(idx) { if (window.motivosDispensaCache[idx]) document.getElementById('skip-obs-input').value = window.motivosDispensaCache[idx].texto; }

// =========================================================================
// 6. MATRIZ DO CRONOGRAMA & RENDERIZAÇÃO DOS CARTÕES (COM TRAVA DE DONO)
// =========================================================================
function gerarMatrizMes(anoRef, mesRef, execsBase) {
  const agenda = {};
  const hoje = new Date(), hojeStr = dataISO(hoje);
  const totalDiasMes = new Date(anoRef, mesRef + 1, 0).getDate();
  const diasUteisMes = [];

  for (let dia = 1; dia <= totalDiasMes; dia++) {
    const d = new Date(anoRef, mesRef, dia), dStr = dataISO(d), util = diaUtil(d);
    agenda[dStr] = { data: d, util: util, tarefas: [], minutos: 0 };
    if (util) diasUteisMes.push(dStr);
  }

  const cliObj = window.clientesDB.find(c => c.nome === clienteAtivo);
  const quadroContrato = Number(cliObj?.quadro_contratado_qtd) || 2;
  const LIMITE_DIARIO = (cliObj ? Number(cliObj.teto_diario_horas) : 6) * quadroContrato * 60;
  const execsCli = window.execucoesHistorico60dDB.filter(e => e.cliente === clienteAtivo);

  const tarefasCliente = window.cronogramaTodosDB
    .filter(t => t.cliente === clienteAtivo && t.ativo !== false)
    .map(t => {
      const minCalib = calcularDuracaoCalibradaTarefa(t);
      return { ...t, duracao_minutos: minCalib, duracao_str: formatarMinutosStr(minCalib) };
    });

  const addTarefaSemDuplicar = (dStr, item) => {
    if (!agenda[dStr]) return;
    if (item.id && agenda[dStr].tarefas.some(x => x.id === item.id)) return;
    agenda[dStr].tarefas.push(item);
    agenda[dStr].minutos += (Number(item.duracao_minutos) || 30);
  };

  tarefasCliente.forEach(t => {
    if (t.data_alvo && t.data_alvo < hojeStr) {
      const foiResolvida = execsCli.some(e => ['CONCLUIDO', 'DISPENSADO'].includes(e.status_execucao) && execCorrespondeTarefa(e, t));
      if (!foiResolvida) addTarefaSemDuplicar(hojeStr, { ...t, is_transbordo: true, prioridade: 0 });
    }
  });

  const ultimoUtilAnt = ultimoDiaUtilAnteriorISO(hoje);
  tarefasCliente.forEach(t => {
    const flutuante = isFreqFlutuante(t.frequencia);
    if (t.data_alvo && agenda[t.data_alvo]) {
      addTarefaSemDuplicar(t.data_alvo, { ...t });
    } else if (!t.data_alvo && !flutuante) {
      diasUteisMes.forEach(dStr => {
        if (diaCorrespondeFrequencia(t.frequencia, agenda[dStr].data.getDay())) {
          let extraFlags = {};
          if (dStr === hojeStr && t.vital && isFreqDiaria(t.frequencia)) {
            const feitaOntem = execsCli.some(e => e.data_referencia === ultimoUtilAnt && ['CONCLUIDO', 'DISPENSADO'].includes(e.status_execucao) && execCorrespondeTarefa(e, t));
            if (!feitaOntem) extraFlags = { vital_critica_ontem: true, prioridade: 0 };
          }
          addTarefaSemDuplicar(dStr, { ...t, ...extraFlags });
        }
      });
    }
  });

  if (agenda[hojeStr]) {
    tarefasCliente.forEach(t => {
      if (!t.vital || t.data_alvo || isFreqFlutuante(t.frequencia) || isFreqDiaria(t.frequencia)) return;
      if (agenda[hojeStr].tarefas.some(x => x.id === t.id)) return;
      for (let off = 1; off <= 7; off++) {
        const dAnt = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - off);
        if (!diaUtil(dAnt) || !diaCorrespondeFrequencia(t.frequencia, dAnt.getDay())) continue;
        const dAntISO = dataISO(dAnt);
        const atendidaDepois = execsCli.some(e => e.data_referencia >= dAntISO && e.data_referencia <= hojeStr && ['CONCLUIDO', 'DISPENSADO', 'IMPEDIMENTO_EPI'].includes(e.status_execucao) && execCorrespondeTarefa(e, t));
        if (!atendidaDepois) {
          addTarefaSemDuplicar(hojeStr, { ...t, is_transbordo: true, vital_atrasada_de: dAnt.toLocaleDateString('pt-BR', { weekday: 'short' }), prioridade: 0 });
        }
        break;
      }
    });
  }

  const diasUteisAlvo = diasUteisMes.filter(dStr => dStr >= hojeStr);
  const baseDiasFlutuantes = diasUteisAlvo.length > 0 ? diasUteisAlvo : diasUteisMes;

  tarefasCliente.forEach(t => {
    if (t.data_alvo || !isFreqFlutuante(t.frequencia)) return;
    const minTotalMes = Number(t.duracao_minutos) || 60;
    const execsDestaTarefa = execsBase.filter(e => e.cliente === clienteAtivo && e.status_execucao === 'CONCLUIDO' && execCorrespondeTarefa(e, t));
    const minJaRealizados = execsDestaTarefa.reduce((acc, cur) => acc + (Number(cur.duracao_real_min) || 0), 0);
    let minRestantes = Math.max(0, minTotalMes - minJaRealizados);
    if (minRestantes === 0) return;

    const fatiaIdeal = minTotalMes > 240 ? 120 : minRestantes;
    let guard = 0;
    while (minRestantes > 0 && baseDiasFlutuantes.length > 0 && guard < 45) {
      guard++;
      const candidatos = baseDiasFlutuantes.filter(dStr => (LIMITE_DIARIO - agenda[dStr].minutos) >= 15 && !agenda[dStr].tarefas.some(x => x.id === t.id));
      if (candidatos.length === 0) break;
      let melhorDia = candidatos[0];
      candidatos.forEach(dStr => { if (agenda[dStr].minutos < agenda[melhorDia].minutos) melhorDia = dStr; });
      const alocar = Math.min(minRestantes, fatiaIdeal, LIMITE_DIARIO - agenda[melhorDia].minutos);
      addTarefaSemDuplicar(melhorDia, { ...t, duracao_minutos: alocar, duracao_str: formatarMinutosStr(alocar), total_mes_min: minTotalMes, realizado_mes_min: minJaRealizados });
      minRestantes -= alocar;
    }
  });

  if (agenda[hojeStr]) {
    window.execucoesMesDB.filter(e => e.cliente === clienteAtivo && ['EM_ANDAMENTO', 'PAUSADO'].includes(e.status_execucao)).forEach(execAberta => {
      if (!agenda[hojeStr].tarefas.some(t => execCorrespondeTarefa(execAberta, t))) {
        addTarefaSemDuplicar(hojeStr, {
          id: execAberta.tarefa_id, cliente: clienteAtivo, setor: execAberta.setor, atividade: execAberta.atividade,
          especie: execAberta.especie || 'Geral', frequencia: 'Em Curso',
          duracao_minutos: execAberta.duracao_estimada_min || 45,
          duracao_str: formatarMinutosStr(execAberta.duracao_estimada_min || 45),
          permite_chuva: true, prioridade: 0, is_transbordo: true
        });
      }
    });
  }

  Object.keys(agenda).forEach(dStr => {
    let lista = agenda[dStr].tarefas;
    if (dStr === hojeStr && modoChuvaAtivo) {
      lista = lista.filter(t => {
        const areaObj = window.areasClienteDB.find(a => a.nome_area === t.setor);
        const areaPermite = areaObj ? areaObj.permite_chuva : true;
        return (t.permite_chuva !== false && areaPermite !== false) || t.is_transbordo;
      });
    }
    lista.sort((a, b) => (a.prioridade ?? 2) - (b.prioridade ?? 2));
    agenda[dStr].tarefas = lista;
    agenda[dStr].minutos = lista.reduce((acc, cur) => acc + (Number(cur.duracao_minutos) || 0), 0);
  });
  return agenda;
}

function recalcularTudo() {
  atualizarBannerCheckin();
  const hoje = new Date();
  window.agendaMesAtual = gerarMatrizMes(hoje.getFullYear(), hoje.getMonth(), window.execucoesMesDB);
  window.agendaCalendario = (calAnoAtivo === hoje.getFullYear() && calMesAtivo === hoje.getMonth())
    ? window.agendaMesAtual
    : gerarMatrizMes(calAnoAtivo, calMesAtivo, execucoesCalendarioCache);
  renderizarTarefasHoje();
  renderFullMonthCalendar();
  if (typeof atualizarBotaoFilaOffline === 'function') atualizarBotaoFilaOffline();
}

function setFiltroTarefas(novoFiltro) {
  filtroTarefasHoje = novoFiltro;
  ['PENDENTES', 'TODAS', 'RESOLVIDAS'].forEach(f => {
    document.getElementById(`btn-filtro-${f}`).className = (f === novoFiltro)
      ? "py-2 px-2 rounded-xl text-[11px] font-extrabold bg-slate-900 text-white shadow-sm transition-all flex items-center justify-center gap-1"
      : "py-2 px-2 rounded-xl text-[11px] font-extrabold text-slate-600 hover:text-slate-900 transition-all flex items-center justify-center gap-1";
  });
  renderizarTarefasHoje();
}

function setFiltroTipoAtividade(tipoNome) { filtroTipoAtividadeHoje = tipoNome; renderizarTarefasHoje(); }

function renderizarBarraFiltroTipos(atividadesVisiveisNoStatus) {
  const bar = document.getElementById('filtro-tipo-atividades-bar');
  if (!bar) return;
  if (atividadesVisiveisNoStatus.length === 0 && filtroTipoAtividadeHoje === 'TODOS') { bar.classList.add('hidden'); return; }

  const contagens = [];
  window.tiposAtividadeDB.forEach(tipo => {
    const qtd = atividadesVisiveisNoStatus.filter(txt => atividadeCombinaComTipo(txt, tipo)).length;
    if (qtd > 0 || filtroTipoAtividadeHoje === tipo.nome) contagens.push({ nome: tipo.nome, icone: tipo.icone || '🌿', qtd });
  });
  if (contagens.length < 2 && filtroTipoAtividadeHoje === 'TODOS') { bar.classList.add('hidden'); return; }

  bar.classList.remove('hidden');
  const chipTodos = `<button onclick="setFiltroTipoAtividade('TODOS')" class="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold transition-all border ${filtroTipoAtividadeHoje === 'TODOS' ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-700 border-slate-300 hover:border-orange-400'}">Todas (${atividadesVisiveisNoStatus.length})</button>`;
  const chipsTipos = contagens.map(c => {
    const ativo = filtroTipoAtividadeHoje === c.nome;
    const nomeEsc = c.nome.replace(/'/g, "\\'");
    return `<button onclick="setFiltroTipoAtividade('${nomeEsc}')" class="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-extrabold transition-all border flex items-center gap-1 ${ativo ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-700 border-slate-300 hover:border-orange-400'}"><span>${c.icone}</span><span>${c.nome}</span><span class="text-[9px] px-1.5 py-0.2 rounded-full ${ativo ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}">${c.qtd}</span></button>`;
  }).join('');
  bar.innerHTML = chipTodos + chipsTipos;
}

function agruparExecucoesEmLotes(listaExecs) {
  const mapa = new Map();
  listaExecs.forEach(e => {
    const k = e.grupo_execucao_id || `SINGLE_${e.id}`;
    if (!mapa.has(k)) mapa.set(k, { chaveLote: k, grupo_execucao_id: e.grupo_execucao_id || null, principal: e, registros: [] });
    mapa.get(k).registros.push(e);
  });
  return Array.from(mapa.values());
}

function construirCartaoLoteResolvidoHtml(lote, loteIdx, turnoEncerradoHoje) {
  const e = lote.principal, st = e.status_execucao;
  const especiesTxt = [...new Set(lote.registros.map(r => r.especie).filter(Boolean))].join(', ');
  const tempoTotal = lote.registros.reduce((acc, r) => acc + (Number(r.duracao_real_min) || 0), 0);
  const podeCorrigir = !turnoEncerradoHoje && souDonoTarefa(e);

  if (st === 'IMPEDIMENTO_EPI') {
    return `<div class="bg-amber-50/90 rounded-2xl p-4 border border-amber-300 shadow-sm"><div class="flex justify-between items-start mb-1.5"><span class="text-xs font-extrabold text-amber-950 bg-amber-200 px-2 py-0.5 rounded-lg">${e.setor}</span><span class="text-[10px] font-extrabold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">⚠️ Falta EPI</span></div><h3 class="text-sm font-bold text-slate-700 line-through">${e.atividade}</h3>${especiesTxt ? `<p class="text-[10px] font-bold text-amber-900 mt-0.5">🌿 ${especiesTxt}</p>` : ''}<p class="text-[11px] text-amber-900 mt-1 italic">"${e.observacao}"</p></div>`;
  }

  const btnEditarHoje = podeCorrigir
    ? `<button onclick="abrirModalEdicaoLoteConcluido(${loteIdx})" class="mt-2.5 w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold py-2 px-3 rounded-xl text-[11px] flex items-center justify-center gap-1.5 shadow-sm"><i data-lucide="pencil" class="w-3.5 h-3.5 text-orange-500"></i> ✏️ Corrigir Entrega</button>`
    : '';

  if (st === 'DISPENSADO') {
    return `<div class="bg-sky-50/80 rounded-2xl p-4 border border-sky-200 shadow-sm"><div class="flex justify-between items-start mb-1.5"><span class="text-xs font-extrabold text-sky-900 bg-sky-200/70 px-2 py-0.5 rounded-lg">${e.setor}</span><span class="text-[10px] font-extrabold text-sky-800 flex items-center gap-1"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Vistoriado</span></div><h3 class="text-sm font-bold text-slate-700 line-through">${e.atividade}</h3>${especiesTxt ? `<p class="text-[10px] font-bold text-sky-900 mt-0.5">🌿 ${especiesTxt}</p>` : ''}<p class="text-[11px] text-sky-900 mt-1 italic">"${e.observacao}"</p><p class="text-[10px] font-bold text-slate-500 mt-1">👷 ${e.equipe_executora}</p>${btnEditarHoje}</div>`;
  }

  const fotosDepoisArr = extrairListaFotos(e.foto_depois_url);
  const tagParcial = e.entrega_parcial ? `<span class="text-[9px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Parcial</span>` : '';
  return `<div class="bg-emerald-50/70 rounded-2xl p-4 border border-emerald-200 shadow-sm"><div class="flex justify-between items-start mb-1.5"><div class="flex items-center gap-1.5"><span class="text-xs font-extrabold text-emerald-900 bg-emerald-200/70 px-2 py-0.5 rounded-lg">${e.setor}</span>${tagParcial}</div><span class="text-[10px] font-extrabold text-emerald-800 flex items-center gap-1"><i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> ${formatarMinutosStr(tempoTotal)}</span></div><h3 class="text-sm font-bold text-slate-700 line-through">${e.atividade}</h3>${especiesTxt ? `<p class="text-[10px] font-bold text-emerald-900 mt-0.5">🌿 ${especiesTxt}</p>` : ''}<p class="text-[11px] text-slate-600 mt-1 italic">"${e.observacao}"</p><div class="flex justify-between items-center mt-1.5"><span class="text-[10px] font-bold text-slate-600">👷 ${e.equipe_executora}</span><span class="text-[10px] font-bold text-emerald-700">📸 ${fotosDepoisArr.length} foto(s)</span></div>${btnEditarHoje}</div>`;
}

function atualizarTempoCartaoGrupo(grpIdx) {
  const grp = window.gruposPendentesCache[grpIdx];
  if (!grp) return;
  const marcados = Array.from(document.querySelectorAll(`input[data-grp-idx="${grpIdx}"]:checked`)).map(c => Number(c.value));
  const somaMin = grp.itens.filter((_, i) => marcados.includes(i)).reduce((acc, t) => acc + (Number(t.duracao_minutos) || 30), 0);
  const badgeEl = document.getElementById(`badge-dur-grp-${grpIdx}`);
  if (badgeEl) badgeEl.innerHTML = `<i data-lucide="clock" class="w-3 h-3"></i> ${somaMin > 0 ? formatarMinutosStr(somaMin) : '0m'}`;
  initIcons();
}

function renderizarTarefasHoje() {
  window.fotosZoomCache = [];
  window.gruposPendentesCache = [];
  window.lotesAtivosCache = [];
  window.lotesResolvidosCache = [];

  const container = document.getElementById('task-container');
  const emptyState = document.getElementById('empty-state-tasks');
  const emptyTitle = document.getElementById('empty-state-title');
  const emptySub = document.getElementById('empty-state-sub');
  const hojeStr = dataISO(), bloqueado = postoBloqueadoHoje();
  const turnoEncerradoHoje = window.presencaHojeDB?.status_validacao === 'TURNO_ENCERRADO';
  const semSinalAgora = !navigator.onLine;

  const diaAgenda = window.agendaMesAtual[hojeStr] || { tarefas: [], minutos: 0 };
  const tarefasHoje = bloqueado ? [] : diaAgenda.tarefas;
  const execsCliente = window.execucoesMesDB.filter(e => e.cliente === clienteAtivo);

  const execsAtivasHoje = execsCliente.filter(e => ['EM_ANDAMENTO', 'PAUSADO'].includes(e.status_execucao));
  const execsResolvidasHoje = execsCliente.filter(e => ['CONCLUIDO', 'DISPENSADO', 'IMPEDIMENTO_EPI'].includes(e.status_execucao) && e.data_referencia === hojeStr);

  window.lotesAtivosCache = agruparExecucoesEmLotes(execsAtivasHoje);
  window.lotesResolvidosCache = agruparExecucoesEmLotes(execsResolvidasHoje);

  const tarefasPendentes = tarefasHoje.filter(t => !execsAtivasHoje.some(e => execCorrespondeTarefa(e, t)) && !execsResolvidasHoje.some(e => execCorrespondeTarefa(e, t)));

  const mapaGrupos = new Map();
  tarefasPendentes.forEach(t => {
    const chaveGrp = `${t.setor}||${t.atividade}||${t.frequencia}||${t.vital_atrasada_de || ''}`;
    if (!mapaGrupos.has(chaveGrp)) {
      mapaGrupos.set(chaveGrp, {
        chaveGrp, setor: t.setor, atividade: t.atividade, frequencia: t.frequencia,
        vital: Boolean(t.vital), vital_atrasada_de: t.vital_atrasada_de || null,
        vital_critica_ontem: Boolean(t.vital_critica_ontem), is_transbordo: Boolean(t.is_transbordo),
        prioridade: t.prioridade ?? 2, itens: []
      });
    }
    const g = mapaGrupos.get(chaveGrp);
    g.itens.push(t);
    if (t.vital) g.vital = true;
    if ((t.prioridade ?? 2) < g.prioridade) g.prioridade = t.prioridade;
  });
  window.gruposPendentesCache = Array.from(mapaGrupos.values()).sort((a, b) => a.prioridade - b.prioridade);

  const atividadesNoStatusAtual = [];
  if (filtroTarefasHoje !== 'RESOLVIDAS') {
    window.lotesAtivosCache.forEach(l => atividadesNoStatusAtual.push(l.principal.atividade));
    window.gruposPendentesCache.forEach(g => atividadesNoStatusAtual.push(g.atividade));
  }
  if (filtroTarefasHoje !== 'PENDENTES') window.lotesResolvidosCache.forEach(l => atividadesNoStatusAtual.push(l.principal.atividade));
  renderizarBarraFiltroTipos(atividadesNoStatusAtual);

  const tipoFiltroObj = filtroTipoAtividadeHoje === 'TODOS' ? null : window.tiposAtividadeDB.find(t => t.nome === filtroTipoAtividadeHoje);
  const passaFiltroTipo = (nomeAtiv) => !tipoFiltroObj || atividadeCombinaComTipo(nomeAtiv, tipoFiltroObj);

  const pendentesCartoesCount = window.lotesAtivosCache.length + window.gruposPendentesCache.length;
  const resolvidasCartoesCount = window.lotesResolvidosCache.length;
  const totalCartoesDia = pendentesCartoesCount + resolvidasCartoesCount;

  let htmlPrincipal = '', htmlConcluidasRodape = '';

  if (filtroTarefasHoje !== 'RESOLVIDAS') {
    window.lotesAtivosCache.forEach((lote, lIdx) => {
      const e = lote.principal;
      if (!passaFiltroTipo(e.atividade)) return;
      const especiesTxt = [...new Set(lote.registros.map(r => r.especie).filter(Boolean))].join(', ');
      const fotosAntesArr = extrairListaFotos(e.foto_antes_url);
      const isDono = souDonoTarefa(e);
      const apoiosAtivos = obterApoiosAtivos(e);
      const badgeApoioHtml = apoiosAtivos.length > 0
        ? `<p class="text-[10px] font-bold text-blue-700 mt-1">🤝 Apoio ativo: ${apoiosAtivos.map(a => a.nome).join(', ')}</p>`
        : '';

      if (!isDono) {
        const estouNoApoio = apoiosAtivos.some(a => normalizarTexto(a.nome) === normalizarTexto(window.usuarioLogado?.nome));
        const stTxt = e.status_execucao === 'PAUSADO' ? '⏸️ Pausado' : '🟠 Em Execução';
        htmlPrincipal += `
        <div class="bg-slate-50 rounded-2xl p-4 border border-slate-300 shadow-sm opacity-95">
          <div class="flex justify-between items-start mb-1.5">
            <span class="text-xs font-extrabold text-slate-700 bg-slate-200 px-2 py-0.5 rounded-lg">${e.setor}</span>
            <span class="text-[10px] font-extrabold bg-slate-700 text-white px-2 py-0.5 rounded-full">${stTxt}</span>
          </div>
          <h3 class="text-sm font-extrabold text-slate-800">${e.atividade}</h3>
          ${especiesTxt ? `<p class="text-[11px] font-bold text-slate-600 mt-0.5">🌿 ${especiesTxt}</p>` : ''}
          ${badgeApoioHtml}
          <div class="mt-3 p-2.5 rounded-xl ${estouNoApoio ? 'bg-blue-50 border border-blue-200 text-blue-900' : 'bg-slate-200/70 text-slate-600'} text-[11px] font-bold flex items-center gap-1.5">
            <i data-lucide="lock" class="w-3.5 h-3.5 flex-shrink-0"></i>
            <span>${estouNoApoio ? `Você está no apoio desta tarefa • Encerramento exclusivo de ${e.registrado_por}` : `Em execução por ${e.registrado_por} (somente leitura)`}</span>
          </div>
        </div>`;
        return;
      }

      if (e.status_execucao === 'PAUSADO') {
        const horaPausa = e.dh_inicio_pausa ? new Date(e.dh_inicio_pausa).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const zIdx = fotosAntesArr[0] ? registrarFotoZoom(fotosAntesArr[0], `INICIAL • ${e.setor}`) : -1;
        htmlPrincipal += `
        <div class="bg-amber-50 rounded-2xl p-4 border-2 border-amber-300 shadow-sm">
          <div class="flex justify-between items-start mb-1.5">
            <span class="text-xs font-extrabold text-amber-950 bg-amber-200 px-2 py-0.5 rounded-lg">${e.setor}</span>
            <span class="text-[10px] font-extrabold bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded-full">⏸️ Pausado (${horaPausa})</span>
          </div>
          <h3 class="text-sm font-extrabold text-slate-900">${e.atividade}</h3>
          ${especiesTxt ? `<p class="text-[11px] font-bold text-amber-900 mt-0.5">🌿 ${especiesTxt}</p>` : ''}
          <p class="text-[11px] font-semibold text-amber-800 mt-0.5">Motivo: ${e.motivo_pausa || 'Intervalo'}</p>
          ${badgeApoioHtml}
          <div class="flex items-center gap-1.5 mt-3">
            ${zIdx >= 0 ? `<img onclick="abrirZoomFotoByIdx(${zIdx})" src="${fotosAntesArr[0]}" class="w-11 h-11 rounded-xl object-cover border border-amber-300 flex-shrink-0 cursor-pointer">` : ''}
            <button onclick="abrirModalApoioLote(${lIdx})" class="bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold py-2.5 px-2.5 rounded-xl text-[11px]">🤝 Apoio</button>
            <button onclick="retomarLotePausado(${lIdx})" class="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 shadow-sm"><i data-lucide="play" class="w-4 h-4 text-emerald-400"></i> Retomar</button>
            <button onclick="abrirModalConclusaoLote(${lIdx})" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 px-2.5 rounded-xl text-xs">Concluir</button>
          </div>
        </div>`;
      } else {
        const horaIni = new Date(e.dh_inicio_tarefa).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const minPausaAcum = Number(e.minutos_pausa_descontados) || 0;
        const miniaturasHtml = fotosAntesArr.map(u => `<img onclick="abrirZoomFotoByIdx(${registrarFotoZoom(u, `INICIAL • ${e.setor}`)})" src="${u}" class="w-11 h-11 rounded-xl object-cover border border-orange-300 flex-shrink-0 cursor-pointer">`).join('');

        htmlPrincipal += `
        <div class="bg-orange-50/90 rounded-2xl p-4 border-2 border-orange-300 shadow-sm">
          <div class="flex justify-between items-start mb-1.5">
            <span class="text-xs font-extrabold text-orange-900 bg-orange-200/80 px-2 py-0.5 rounded-lg">${e.setor}</span>
            <span class="text-[10px] font-extrabold bg-orange-500 text-white px-2 py-0.5 rounded-full animate-pulse">🟠 Em Execução (${horaIni})</span>
          </div>
          <h3 class="text-sm font-extrabold text-slate-900">${e.atividade}</h3>
          ${especiesTxt ? `<p class="text-[11px] font-bold text-orange-900 mt-0.5">🌿 ${especiesTxt}</p>` : ''}
          ${e.observacao && e.observacao !== 'Atividade em andamento...' ? `<p class="text-[11px] text-orange-900 mt-0.5 italic">"${e.observacao}"</p>` : ''}
          ${minPausaAcum > 0 ? `<p class="text-[10px] font-bold text-slate-500 mt-0.5">⏱️ Pausa descontada: ${minPausaAcum}m</p>` : ''}
          ${badgeApoioHtml}
          <div class="flex items-center justify-between mt-2.5 gap-1.5">
            <div class="flex items-center gap-1.5">${miniaturasHtml}</div>
            <div class="flex items-center gap-1.5">
              <button onclick="abrirModalApoioLote(${lIdx})" class="text-[11px] font-extrabold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-300 px-2.5 py-1.5 rounded-xl shadow-sm">🤝 +Apoio</button>
              <button onclick="abrirModalEditarLoteAtivo(${lIdx})" class="text-[11px] font-bold text-slate-700 bg-white border border-slate-300 px-2.5 py-1.5 rounded-xl shadow-sm">✏️</button>
            </div>
          </div>
          <div class="flex items-center gap-1.5 mt-3">
            <button onclick="abrirModalProgressoLote(${lIdx})" class="bg-white hover:bg-orange-100 text-orange-800 border border-orange-300 font-extrabold py-2.5 px-2 rounded-xl text-[11px] flex items-center gap-1"><i data-lucide="camera" class="w-3.5 h-3.5 text-orange-600"></i> +Foto</button>
            <button onclick="abrirModalPausaLote(${lIdx})" class="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-extrabold py-2.5 px-2 rounded-xl text-[10px] flex items-center gap-1"><i data-lucide="pause" class="w-3.5 h-3.5"></i> Pausar</button>
            <button onclick="abrirModalConclusaoLote(${lIdx})" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1 shadow-sm"><i data-lucide="check-square" class="w-4 h-4"></i> Concluir</button>
          </div>
        </div>`;
      }
    });

    window.gruposPendentesCache.forEach((grp, grpIdx) => {
      if (!passaFiltroTipo(grp.atividade)) return;
      const areaObj = window.areasClienteDB.find(a => a.nome_area === grp.setor);
      const epiExtra = grp.itens.map(i => i.epi_especifico).filter(Boolean)[0] || '';
      const epiExigido = [areaObj?.epi_obrigatorio, epiExtra].filter(Boolean).join(' + ');

      const badgeEpi = epiExigido ? `<span class="text-[9px] font-extrabold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded border border-amber-300">🦺 EPI</span>` : '';
      const badgeVitalAtrasada = grp.vital_atrasada_de
        ? `<span class="text-[9px] font-extrabold bg-red-600 text-white px-2 py-0.5 rounded uppercase animate-pulse">🚨 VITAL ATRASADA (${grp.vital_atrasada_de})</span>`
        : (grp.vital_critica_ontem
          ? `<span class="text-[9px] font-extrabold bg-red-600 text-white px-2 py-0.5 rounded uppercase animate-pulse">🚨 CRÍTICA</span>`
          : (grp.vital ? `<span class="text-[9px] font-extrabold bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded border border-emerald-300">🌿 VITAL</span>` : ''));
      const badgeTransbordo = (!grp.vital_atrasada_de && grp.is_transbordo) ? `<span class="text-[9px] font-extrabold bg-red-100 text-red-800 px-1.5 py-0.5 rounded uppercase border border-red-200">🔄 Pendente</span>` : '';

      const somaMinGrupo = grp.itens.reduce((acc, t) => acc + (Number(t.duracao_minutos) || 30), 0);
      const bordaDestaque = (grp.vital_atrasada_de || grp.vital_critica_ontem)
        ? 'border-2 border-red-400 bg-red-50/30'
        : (grp.prioridade === 1 ? 'border border-slate-200 border-l-4 border-l-orange-500 bg-white' : 'border border-slate-200/90 bg-white');

      let blocoEspeciesHtml = grp.itens.length > 1
        ? `<div class="mt-2 bg-slate-50 border border-slate-200/80 rounded-xl p-2 space-y-1.5"><p class="text-[9px] font-extrabold text-slate-500 uppercase">Espécies no local:</p><div class="flex flex-wrap gap-1.5">${grp.itens.map((it, itIdx) => `<label class="flex items-center gap-1.5 bg-white border border-slate-300 px-2 py-1 rounded-lg cursor-pointer hover:border-orange-400 text-[11px] font-bold text-slate-800 shadow-sm"><input type="checkbox" data-grp-idx="${grpIdx}" value="${itIdx}" checked onchange="atualizarTempoCartaoGrupo(${grpIdx})" class="w-3.5 h-3.5 text-orange-500 rounded"><span>${it.especie || 'Geral'}</span><span class="text-[9px] text-slate-400 font-semibold">(${it.duracao_str})</span></label>`).join('')}</div></div>`
        : `<p class="text-[11px] text-slate-500 mt-0.5">🌿 Espécie: <b>${grp.itens[0].especie || 'Geral'}</b> • Freq: ${grp.frequencia}</p>`;

      const btnIniClass = semSinalAgora
        ? 'flex-1 bg-slate-300 text-slate-600 font-bold py-2.5 px-2 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-not-allowed'
        : 'flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-2 rounded-xl text-xs flex items-center justify-center gap-1.5';

      htmlPrincipal += `
      <div class="rounded-2xl p-4 shadow-sm ${bordaDestaque}">
        <div class="flex justify-between items-start mb-1.5 gap-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-extrabold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg">${grp.setor}</span>
            ${badgeVitalAtrasada} ${badgeEpi} ${badgeTransbordo}
          </div>
          <span id="badge-dur-grp-${grpIdx}" class="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1 flex-shrink-0"><i data-lucide="clock" class="w-3 h-3"></i> ${formatarMinutosStr(somaMinGrupo)}</span>
        </div>
        <h3 class="text-sm font-bold text-slate-900 mt-1">${grp.atividade}</h3>
        ${blocoEspeciesHtml}
        <div class="mt-3 flex gap-1.5">
          <button onclick="iniciarGrupoByIdx(${grpIdx}, 'CAMERA_APP')" class="${btnIniClass}"><i data-lucide="${semSinalAgora ? 'wifi-off' : 'camera'}" class="w-4 h-4 ${semSinalAgora ? 'text-slate-500' : 'text-orange-400'}"></i> ${semSinalAgora ? 'Sem sinal p/ Iniciar' : 'Iniciar (Foto)'}</button>
          <button onclick="iniciarGrupoByIdx(${grpIdx}, 'GALERIA_EXIF')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 px-2.5 rounded-xl text-xs border border-slate-200 ${semSinalAgora ? 'opacity-50' : ''}" title="Galeria EXIF"><i data-lucide="image" class="w-4 h-4"></i></button>
          <button onclick="abrirModalSkipGrupoByIdx(${grpIdx})" class="bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 font-bold py-2.5 px-2.5 rounded-xl text-[11px] flex items-center gap-1 ${semSinalAgora ? 'opacity-50' : ''}"><i data-lucide="skip-forward" class="w-3.5 h-3.5"></i> Dispensar</button>
        </div>
      </div>`;
    });
  }

  window.lotesResolvidosCache.forEach((lote, lIdx) => {
    const cardHtml = construirCartaoLoteResolvidoHtml(lote, lIdx, turnoEncerradoHoje);
    if (passaFiltroTipo(lote.principal.atividade)) {
      htmlConcluidasRodape += cardHtml;
      if (filtroTarefasHoje !== 'PENDENTES') htmlPrincipal += cardHtml;
    }
  });

  document.getElementById('count-filtro-PENDENTES').textContent = pendentesCartoesCount;
  document.getElementById('count-filtro-TODAS').textContent = totalCartoesDia;
  document.getElementById('count-filtro-RESOLVIDAS').textContent = resolvidasCartoesCount;

  const secRodape = document.getElementById('secao-concluidas-sempre-visivel');
  if (htmlConcluidasRodape && filtroTarefasHoje === 'PENDENTES') {
    secRodape.classList.remove('hidden');
    document.getElementById('badge-qtd-resolvidas-rodape').textContent = resolvidasCartoesCount;
    document.getElementById('lista-concluidas-rodape').innerHTML = htmlConcluidasRodape;
  } else secRodape.classList.add('hidden');

  const pctDia = totalCartoesDia > 0 ? Math.round((resolvidasCartoesCount / totalCartoesDia) * 100) : 0;
  document.getElementById('progresso-texto').textContent = `${resolvidasCartoesCount} de ${totalCartoesDia} blocos resolvidos`;
  document.getElementById('progresso-barra').style.width = `${pctDia}%`;

  const cargaBadge = document.getElementById('carga-hoje-badge');
  if (cargaBadge) cargaBadge.textContent = `Previsto: ${formatarMinutosStr(diaAgenda.minutos)}`;

  if (!htmlPrincipal) {
    container.classList.add('hidden'); emptyState.classList.remove('hidden');
    if (bloqueado) { emptyTitle.textContent = "Posto Fechado Hoje"; emptySub.textContent = "Expediente suspenso (Fim de Semana / Feriado)."; }
    else if (filtroTipoAtividadeHoje !== 'TODOS') { emptyTitle.textContent = `Nenhuma atividade de "${filtroTipoAtividadeHoje}"`; emptySub.textContent = "Toque em 'Todas' nos filtros acima."; }
    else if (filtroTarefasHoje === 'PENDENTES' && totalCartoesDia > 0) { emptyTitle.textContent = "🎉 Zero Pendências!"; emptySub.textContent = "Todos os blocos de hoje foram resolvidos."; }
    else { emptyTitle.textContent = "Nenhuma atividade neste filtro"; emptySub.textContent = "Altere o filtro acima para visualizar as demais tarefas."; }
  } else {
    emptyState.classList.add('hidden'); container.classList.remove('hidden'); container.innerHTML = htmlPrincipal;
  }
  initIcons();
}

// =========================================================================
// 7. CALENDÁRIO & NAVEGAÇÃO DE ABAS
// =========================================================================
function obterEspeciesEmJanelaPoda(mes1a12) {
  return window.especiesClienteDB.filter(sp => sp.meses_poda_drastica && String(sp.meses_poda_drastica).split(',').map(m => parseInt(m.trim(), 10)).includes(mes1a12));
}

async function mudarMesCalendario(delta) {
  calMesAtivo += delta;
  if (calMesAtivo < 0) { calMesAtivo = 11; calAnoAtivo--; } else if (calMesAtivo > 11) { calMesAtivo = 0; calAnoAtivo++; }
  if (navigator.onLine) {
    try {
      const { data } = await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').select('*').eq('cliente', clienteAtivo).gte('data_referencia', dataISO(new Date(calAnoAtivo, calMesAtivo, 1))).lte('data_referencia', dataISO(new Date(calAnoAtivo, calMesAtivo + 1, 0))).order('dh_envio_servidor', { ascending: false }), 5000);
      execucoesCalendarioCache = data || [];
    } catch (e) { execucoesCalendarioCache = []; }
  }
  window.agendaCalendario = gerarMatrizMes(calAnoAtivo, calMesAtivo, execucoesCalendarioCache);
  renderFullMonthCalendar();
}

function renderFullMonthCalendar() {
  const container = document.getElementById('month-days-container'), hojeReal = new Date();
  document.getElementById('mes-titulo').textContent = new Date(calAnoAtivo, calMesAtivo, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const temJanelaPodaMes = obterEspeciesEmJanelaPoda(calMesAtivo + 1).length > 0;

  let html = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => `<div class="month-header">${d}</div>`).join('');
  const primeiroDia = new Date(calAnoAtivo, calMesAtivo, 1).getDay(), totalDias = new Date(calAnoAtivo, calMesAtivo + 1, 0).getDate();
  for (let i = 0; i < primeiroDia; i++) html += `<div class="month-cell empty"></div>`;

  const ehMesAtual = (calAnoAtivo === hojeReal.getFullYear() && calMesAtivo === hojeReal.getMonth());
  const diaSelPadrao = ehMesAtual ? hojeReal.getDate() : 1;

  for (let day = 1; day <= totalDias; day++) {
    const dStr = dataISO(new Date(calAnoAtivo, calMesAtivo, day)), ag = window.agendaCalendario[dStr];
    const execsNoDia = execucoesCalendarioCache.filter(e => e.cliente === clienteAtivo && e.data_referencia === dStr && ['CONCLUIDO', 'DISPENSADO'].includes(e.status_execucao));
    let classes = "month-cell";
    if (ehMesAtual && day === hojeReal.getDate()) classes += " today";
    if (day === diaSelPadrao) classes += " selected";
    if ((!ag || !ag.util) && execsNoDia.length === 0) classes += " bg-slate-50 opacity-60";
    else if (temJanelaPodaMes && ag && ag.util) classes += " poda-window";

    let dots = '';
    if (execsNoDia.length > 0) dots += `<div class="dot bg-emerald-500"></div>`;
    if (ag && ag.tarefas.length > 0) {
      if (ag.tarefas.some(t => t.vital || t.prioridade === 1)) dots += `<div class="dot bg-orange-500"></div>`;
      dots += `<div class="dot bg-blue-500"></div>`;
    }
    html += `<div class="${classes}" onclick="selecionarDiaCalendario('${dStr}', ${day}, this)"><span class="day-num">${day}</span><div class="task-dots">${dots}</div></div>`;
  }
  container.innerHTML = html;
  selecionarDiaCalendario(dataISO(new Date(calAnoAtivo, calMesAtivo, diaSelPadrao)), diaSelPadrao, null);
}

function agendarPodaDrasticaByIdx(idx) {
  const sp = window.especiesPodaMesCache[idx]; if (!sp) return;
  document.getElementById('input-modal-setor').value = sp.nome_area;
  const selTipo = document.getElementById('select-modal-tipo-atividade');
  if ([...selTipo.options].some(o => o.value === 'Poda Drástica')) {
    selTipo.value = 'Poda Drástica'; aoSelecionarTipoAtividadeExtra(); document.getElementById('input-modal-tarefa').value = 'Rejuvenescimento';
  } else {
    selTipo.value = '__OUTRA__'; aoSelecionarTipoAtividadeExtra(); document.getElementById('input-modal-tarefa').value = 'Poda drástica de rejuvenescimento';
  }
  document.getElementById('input-modal-especie').value = sp.especie;
  document.getElementById('input-modal-duracao').value = 60;
  atualizarSugestoesEspecieExtra();
  openExtraModal(true);
}

function selecionarDiaCalendario(dStr, day, el) {
  if (el) { document.querySelectorAll('.month-cell.selected').forEach(c => c.classList.remove('selected')); el.classList.add('selected'); }
  document.getElementById('selected-day-title').textContent = `Histórico & Grade • ${new Date(dStr + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
  const ag = window.agendaCalendario[dStr];
  const execsDia = execucoesCalendarioCache.filter(e => e.cliente === clienteAtivo && e.data_referencia === dStr && ['CONCLUIDO', 'DISPENSADO'].includes(e.status_execucao));
  const lotesDia = agruparExecucoesEmLotes(execsDia);
  const list = document.getElementById('selected-day-list');
  const especiesPoda = obterEspeciesEmJanelaPoda(calMesAtivo + 1);
  window.especiesPodaMesCache = especiesPoda;

  let html = '';
  if (especiesPoda.length > 0 && ag && ag.util) {
    html += `<div class="bg-purple-50 border border-purple-200 rounded-xl p-3 space-y-2"><div class="flex items-start gap-2"><span class="text-base">✂️</span><div><p class="text-[11px] font-extrabold text-purple-950 uppercase">Janela Recomendada: Poda Drástica</p><p class="text-[11px] text-purple-800 mt-0.5">Espécies: <b>${especiesPoda.map(s => `${s.especie} (${s.nome_area})`).join(', ')}</b></p></div></div><button onclick="agendarPodaDrasticaByIdx(0)" class="w-full bg-purple-700 hover:bg-purple-800 text-white font-bold py-2 px-3 rounded-lg text-[11px] shadow-sm">+ Abrir Poda Drástica Hoje</button></div>`;
  }

  if (lotesDia.length > 0) {
    const totalMinDia = execsDia.reduce((a, b) => a + (Number(b.duracao_real_min) || 0), 0);
    document.getElementById('selected-day-count').textContent = `${lotesDia.length} entregue(s) • ${formatarMinutosStr(totalMinDia)}`;
    html += `<p class="text-[10px] font-extrabold text-emerald-700 uppercase tracking-wider px-1 pt-1">✅ Realizado (${lotesDia.length})</p>`;
    html += lotesDia.map(lote => {
      const e = lote.principal, isDisp = e.status_execucao === 'DISPENSADO';
      const espTxt = [...new Set(lote.registros.map(r => r.especie).filter(Boolean))].join(', ');
      const tempoLote = lote.registros.reduce((acc, r) => acc + (Number(r.duracao_real_min) || 0), 0);
      const todasFotos = [...extrairListaFotos(e.foto_antes_url), ...extrairListaFotos(e.foto_depois_url)];
      const thumbs = todasFotos.map(u => `<img onclick="abrirZoomFotoByIdx(${registrarFotoZoom(u, `${e.setor} • ${e.atividade}`)})" src="${u}" class="w-11 h-11 rounded-lg object-cover border border-slate-300 cursor-pointer flex-shrink-0">`).join('');
      return `<div class="p-3 rounded-xl border ${isDisp ? 'bg-sky-50/70 border-sky-200' : 'bg-emerald-50/60 border-emerald-200'} space-y-1.5"><div class="flex justify-between items-start gap-2"><span class="text-[10px] font-extrabold ${isDisp ? 'bg-sky-200 text-sky-900' : 'bg-emerald-200 text-emerald-900'} px-2 py-0.5 rounded">${e.setor}</span><span class="text-[10px] font-extrabold ${isDisp ? 'text-sky-800' : 'text-emerald-800'}">${isDisp ? '☑️ Vistoriado' : `✓ ${formatarMinutosStr(tempoLote)}`}</span></div><p class="text-xs font-extrabold text-slate-900">${e.atividade}</p>${espTxt ? `<p class="text-[10px] font-bold text-slate-700">🌿 ${espTxt}</p>` : ''}<p class="text-[11px] text-slate-600 italic">"${e.observacao || ''}"</p><p class="text-[10px] font-bold text-slate-500">👷 ${e.equipe_executora}</p>${thumbs ? `<div class="flex gap-1.5 pt-1 overflow-x-auto">${thumbs}</div>` : ''}</div>`;
    }).join('');
  }

  if (ag && ag.tarefas.length > 0) {
    const mapaPrev = new Map();
    ag.tarefas.forEach(t => {
      const k = `${t.setor}||${t.atividade}`;
      if (!mapaPrev.has(k)) mapaPrev.set(k, { setor: t.setor, atividade: t.atividade, vital: Boolean(t.vital), itens: [], min: 0 });
      const g = mapaPrev.get(k);
      g.itens.push(t); g.min += (Number(t.duracao_minutos) || 30);
      if (t.vital) g.vital = true;
    });
    const gruposPrev = Array.from(mapaPrev.values());

    if (lotesDia.length === 0) document.getElementById('selected-day-count').textContent = `${gruposPrev.length} blocos • ${(ag.minutos / 60).toFixed(1).replace('.0', '')}h`;
    html += `<p class="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider px-1 pt-2">📋 Previsto (${gruposPrev.length} blocos)</p>`;
    html += gruposPrev.map(g => {
      const todosFeitos = g.itens.every(it => execsDia.some(e => execCorrespondeTarefa(e, it)));
      const espList = g.itens.map(it => it.especie || 'Geral').join(', ');
      return `<div class="flex justify-between items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100 ${todosFeitos ? 'opacity-60' : ''}"><div><p class="text-xs font-bold ${todosFeitos ? 'line-through text-slate-500' : 'text-slate-800'}">${g.vital ? '🌿 ' : ''}${g.atividade}</p><p class="text-[10px] text-slate-600 font-semibold">${g.setor} • ${formatarMinutosStr(g.min)}</p><p class="text-[10px] text-slate-500">Espécies: ${espList}</p></div><span class="text-[10px] font-extrabold flex-shrink-0 ml-2 ${todosFeitos ? 'text-emerald-600' : 'text-slate-400'}">${todosFeitos ? '✓ Feito' : 'Previsto'}</span></div>`;
    }).join('');
  }

  if (!html) { document.getElementById('selected-day-count').textContent = 'Livre'; list.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Sem registros ou rotinas para esta data.</p>`; }
  else list.innerHTML = html;
  initIcons();
}

function switchTab(tab) {
  tabAtual = tab;
  ['hoje', 'calendario', 'suprimentos', 'chat'].forEach(t => {
    document.getElementById(`tab-${t}`).className = (t === tab) ? "flex flex-col items-center py-1.5 text-orange-500 transition-colors relative" : "flex flex-col items-center py-1.5 text-slate-400 hover:text-orange-500 transition-colors relative";
  });
  document.getElementById('tasks-view').classList.toggle('hidden', tab !== 'hoje');
  document.getElementById('calendar-view').classList.toggle('hidden', tab !== 'calendario');
  document.getElementById('suprimentos-view').classList.toggle('hidden', tab !== 'suprimentos');
  document.getElementById('chat-view').classList.toggle('hidden', tab !== 'chat');
  document.getElementById('fab-add').classList.toggle('hidden', tab !== 'hoje' || postoBloqueadoHoje());
  document.getElementById('view-title').textContent = { hoje: 'Cronograma de Hoje', calendario: 'Histórico & Janela Fenológica', suprimentos: 'Suprimentos & EPI', chat: 'Comunicador Interno' }[tab];
  if (tab === 'calendario') renderFullMonthCalendar();
  if (tab === 'chat' && typeof carregarMensagensChat === 'function') { mensagensNaoLidas[canalChatAtivo] = 0; atualizarBadgesNaoLidas(); carregarMensagensChat(); }
}

function trocarClienteManual(novoCli) {
  clienteAtivo = novoCli;
  localStorage.setItem('novaera_cliente_ativo', clienteAtivo);
  filtroTipoAtividadeHoje = 'TODOS';
  suprimentosInicializado = false;
  carregarDadosSupabase();
}

// =========================================================================
// 8. INICIALIZAÇÃO DO APP (PWA + SUPABASE AUTH POR PIN)
// =========================================================================
window.addEventListener('online', () => {
  atualizarBadgeRede(true, false);
  if (typeof sincronizarFilaOffline === 'function') sincronizarFilaOffline();
  validarCheckinSubsoloPendente();
  renderizarTarefasHoje();
});

window.addEventListener('offline', () => {
  atualizarBadgeRede(false, true);
  renderizarTarefasHoje();
});

window.onload = () => {
  NovaEraOffline.registrarPWA();
  document.getElementById('current-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const h = new Date().getHours() * 60 + new Date().getMinutes();
  if (h >= 690 && h <= 840) document.getElementById('pico-alert').classList.remove('hidden');
  atualizarBadgeRede(navigator.onLine, false);
  initIcons();

  NovaEraAuth.init(sb, {
    allowedRoles: ['OPERADOR', 'ENCARREGADO', 'SUPERVISOR', 'ADMIN'],
    titulo: 'Operações de Campo',
    onReady: (profile) => {
      window.usuarioLogado = profile;
      equipeLogada = [profile.nome];
      document.getElementById('header-team-text').textContent = profile.nome.split(' ')[0];
      if (!clienteAtivo) {
        clienteAtivo = profile.cliente_padrao || 'Miss Silvia';
        localStorage.setItem('novaera_cliente_ativo', clienteAtivo);
      }
      carregarDadosSupabase();
      if (typeof atualizarBotaoFilaOffline === 'function') atualizarBotaoFilaOffline();
    }
  });
};
