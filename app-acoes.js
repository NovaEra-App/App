// =========================================================================
// NOVA ERA v10.0 — MÓDULO DE AÇÕES (CÂMERA, +APOIO, OFFLINE, DEPENDENTES)
// =========================================================================
let tarefasSelecionadasLote = [];
let loteAtivoSelecionado = null;
let etapaCaptura = 'antes';
let origemCaptura = 'CAMERA_APP';
let listaFotosDepois = [];
let categoriaSuprimentoAtiva = 'INSUMO';

let loteParaPausa = null;
let loteEditandoAtivo = null;
let loteProgresso = null;
let fotosAtuaisProgresso = [];
let loteApoioSelecionado = null;
let dadosFotoSkip = null;
let tipoSkipAtivo = 'VISTORIA';
let loteEditandoConcluido = null;
let fotosEdicaoConcluida = [];
let canalRealtimeIniciado = false;

function obterIdsLote(lote) { return lote.registros.map(r => r.id); }

function salvarSnapshotLocalAtual() {
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
}

function atualizarRegistrosEmMemoria(ids, camposUpdate) {
  const atualizarLista = (arr) => arr.forEach(r => {
    if (ids.includes(r.id)) Object.assign(r, camposUpdate);
  });
  atualizarLista(window.execucoesMesDB);
  atualizarLista(window.execucoesHistorico60dDB);
  salvarSnapshotLocalAtual();
}

function montarEquipeExecutoraTexto(regRef, participantesArr) {
  const nomes = new Set();
  if (regRef?.registrado_por) nomes.add(regRef.registrado_por);
  else if (window.usuarioLogado?.nome) nomes.add(window.usuarioLogado.nome);
  (Array.isArray(participantesArr) ? participantesArr : []).forEach(p => {
    if (p?.nome) nomes.add(p.nome);
  });
  return Array.from(nomes).join(', ');
}

function obterItensMarcadosDoGrupo(grpIdx) {
  const grp = window.gruposPendentesCache[grpIdx];
  if (!grp) return [];
  if (grp.itens.length === 1) return grp.itens;
  const marcados = Array.from(document.querySelectorAll(`input[data-grp-idx="${grpIdx}"]:checked`)).map(c => Number(c.value));
  return grp.itens.filter((_, i) => marcados.includes(i));
}

// =========================================================================
// 1. INICIAR TAREFA (SOMENTE ONLINE — EVITA CONFLITO ENTRE OPERADORES)
// =========================================================================
function iniciarGrupoByIdx(grpIdx, origem) {
  if (postoBloqueadoHoje()) { alert("🔒 Posto fechado hoje."); return; }
  if (!navigator.onLine) {
    alert("📵 Sem sinal no momento.\n\nPara evitar conflito com outro colega, iniciar nova tarefa exige conexão. Você pode pausar, retomar ou concluir as tarefas que já abriu.");
    return;
  }
  if (!window.usuarioLogado) return;

  const itens = obterItensMarcadosDoGrupo(grpIdx);
  if (itens.length === 0) { alert("Marque ao menos uma espécie no cartão para iniciar."); return; }

  tarefasSelecionadasLote = itens;
  etapaCaptura = 'antes';
  origemCaptura = origem;

  const areaObj = window.areasClienteDB.find(a => a.nome_area === itens[0].setor);
  const epiExtra = itens.map(i => i.epi_especifico).filter(Boolean)[0] || '';
  const epiExigido = [areaObj?.epi_obrigatorio, epiExtra].filter(Boolean).join(' + ');
  if (epiExigido) {
    document.getElementById('epi-alert-texto').textContent = epiExigido;
    document.getElementById('epi-alert-modal').classList.remove('hidden');
    initIcons();
    return;
  }
  abrirSeletorArquivoCamera(origem);
}

function abrirModalSkipGrupoByIdx(grpIdx) {
  if (postoBloqueadoHoje()) { alert("🔒 Posto fechado hoje."); return; }
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para registrar vistoria ou impedimento."); return; }
  const itens = obterItensMarcadosDoGrupo(grpIdx);
  if (itens.length === 0) { alert("Marque ao menos uma espécie no cartão."); return; }
  abrirModalSkip(itens, false);
}

// =========================================================================
// 2. + APOIO (ENTRADA E SAÍDA DE COLEGAS EM TEMPO REAL)
// =========================================================================
function abrirModalApoioLote(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) {
    alert("🔒 Apenas quem abriu a tarefa pode gerenciar o apoio.");
    return;
  }
  loteApoioSelecionado = lote;
  const reg = lote.principal;
  document.getElementById('apoio-task-title').textContent = `${reg.setor} • ${reg.atividade}`;
  renderizarListaApoioModal();
  document.getElementById('apoio-modal').classList.remove('hidden');
  initIcons();
}

function fecharModalApoio() {
  loteApoioSelecionado = null;
  document.getElementById('apoio-modal').classList.add('hidden');
}

function renderizarListaApoioModal() {
  if (!loteApoioSelecionado) return;
  const reg = loteApoioSelecionado.principal;
  const participantes = obterParticipantesLista(reg);
  const meuNome = window.usuarioLogado?.nome || '';

  const colegas = window.colaboradoresTodosDB.filter(c =>
    c.ativo !== false &&
    normalizarTexto(c.nome) !== normalizarTexto(meuNome) &&
    (!c.cliente_padrao || c.cliente_padrao === clienteAtivo) &&
    ['OPERADOR', 'ENCARREGADO'].includes(String(c.perfil || '').toUpperCase())
  );

  const box = document.getElementById('apoio-lista-colaboradores');
  if (colegas.length === 0) {
    box.innerHTML = `<p class="text-xs text-slate-400 text-center py-4">Nenhum outro operador cadastrado neste posto.</p>`;
    return;
  }

  box.innerHTML = colegas.map(c => {
    const ativoAgora = participantes.find(p => normalizarTexto(p.nome) === normalizarTexto(c.nome) && !p.fim);
    const historico = participantes.filter(p => normalizarTexto(p.nome) === normalizarTexto(c.nome) && p.fim);
    const minJaAjudou = historico.reduce((acc, p) => acc + Math.max(1, Math.round((new Date(p.fim) - new Date(p.inicio)) / 60000)), 0);
    const nomeEsc = c.nome.replace(/'/g, "\\'");
    const uidEsc = (c.auth_user_id || '').replace(/'/g, "\\'");

    if (ativoAgora) {
      const hIni = new Date(ativoAgora.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `
      <div class="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl gap-2">
        <div>
          <p class="text-xs font-extrabold text-slate-900">${c.nome}</p>
          <p class="text-[10px] font-semibold text-blue-700">🟢 No apoio desde ${hIni}</p>
        </div>
        <button onclick="alternarApoioColaborador('${nomeEsc}', '${uidEsc}')" class="bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-extrabold px-3 py-2 rounded-xl">
          Registrar Saída
        </button>
      </div>`;
    }

    return `
    <div class="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl gap-2">
      <div>
        <p class="text-xs font-extrabold text-slate-800">${c.nome}</p>
        <p class="text-[10px] text-slate-500">${minJaAjudou > 0 ? `Já apoiou ${formatarMinutosStr(minJaAjudou)} hoje` : 'Disponível para apoio'}</p>
      </div>
      <button onclick="alternarApoioColaborador('${nomeEsc}', '${uidEsc}')" class="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold px-3 py-2 rounded-xl">
        + Entrar no Apoio
      </button>
    </div>`;
  }).join('');
}

async function alternarApoioColaborador(nomeColab, authUserId) {
  if (!loteApoioSelecionado) return;
  const reg = loteApoioSelecionado.principal;
  const ids = obterIdsLote(loteApoioSelecionado);
  const agoraISO = new Date().toISOString();
  const lista = [...obterParticipantesLista(reg)];

  const idxAtivo = lista.findIndex(p => normalizarTexto(p.nome) === normalizarTexto(nomeColab) && !p.fim);
  if (idxAtivo >= 0) {
    lista[idxAtivo] = { ...lista[idxAtivo], fim: agoraISO };
  } else {
    lista.push({ nome: nomeColab, auth_user_id: authUserId || null, inicio: agoraISO, fim: null });
  }

  const equipeTxt = montarEquipeExecutoraTexto(reg, lista);
  const upd = { participantes: lista, equipe_executora: equipeTxt };

  atualizarRegistrosEmMemoria(ids, upd);
  renderizarListaApoioModal();
  recalcularTudo();

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').update(upd).in('id', ids), 5000);
  } catch (e) {
    await NovaEraOffline.enqueue({ tipo: 'APOIO_UPD', ids, payload: upd });
    atualizarBotaoFilaOffline();
  }
}

// =========================================================================
// 3. PAUSAR, RETOMAR, EDITAR E PROGRESSO (+FOTO) — SUPORTE OFFLINE
// =========================================================================
function abrirModalPausaLote(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) { alert("🔒 Apenas quem abriu a tarefa pode pausar."); return; }
  loteParaPausa = lote;
  document.getElementById('pause-modal').classList.remove('hidden');
  initIcons();
}
function fecharModalPausa() { loteParaPausa = null; document.getElementById('pause-modal').classList.add('hidden'); }

async function confirmarPausaTarefa() {
  if (!loteParaPausa) return;
  const ids = obterIdsLote(loteParaPausa);
  const upd = {
    status_execucao: 'PAUSADO',
    motivo_pausa: document.getElementById('select-motivo-pausa').value || 'Intervalo',
    dh_inicio_pausa: new Date().toISOString()
  };

  atualizarRegistrosEmMemoria(ids, upd);
  fecharModalPausa();
  recalcularTudo();

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').update(upd).in('id', ids), 5000);
  } catch (e) {
    await NovaEraOffline.enqueue({ tipo: 'PAUSA_LOTE', ids, payload: upd });
    atualizarBotaoFilaOffline();
  }
}

async function retomarLotePausado(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) { alert("🔒 Apenas quem abriu a tarefa pode retomar."); return; }
  const reg = lote.principal;
  const ids = obterIdsLote(lote);
  const minPausaSomar = (reg && reg.dh_inicio_pausa) ? Math.max(1, Math.round((Date.now() - new Date(reg.dh_inicio_pausa).getTime()) / 60000)) : 0;
  const upd = {
    status_execucao: 'EM_ANDAMENTO',
    motivo_pausa: null,
    dh_inicio_pausa: null,
    minutos_pausa_descontados: (Number(reg?.minutos_pausa_descontados) || 0) + minPausaSomar
  };

  atualizarRegistrosEmMemoria(ids, upd);
  recalcularTudo();

  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').update(upd).in('id', ids), 5000);
  } catch (e) {
    await NovaEraOffline.enqueue({ tipo: 'RETOMA_LOTE', ids, payload: upd });
    atualizarBotaoFilaOffline();
  }
}

function abrirModalEditarLoteAtivo(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) { alert("🔒 Apenas quem abriu a tarefa pode editar."); return; }
  loteEditandoAtivo = lote;
  const reg = lote.principal;
  const espTxt = lote.registros.map(r => r.especie).filter(Boolean).join(', ');
  document.getElementById('edit-act-title').textContent = `${reg.setor} • ${reg.atividade}${espTxt ? ' (' + espTxt + ')' : ''}`;
  document.getElementById('edit-act-obs').value = reg.observacao || '';
  document.getElementById('edit-active-modal').classList.remove('hidden');
  initIcons();
}

async function salvarEdicaoTarefaAtiva() {
  if (!loteEditandoAtivo) return;
  const ids = obterIdsLote(loteEditandoAtivo);
  const upd = { observacao: document.getElementById('edit-act-obs').value.trim() || 'Atividade em andamento...' };
  atualizarRegistrosEmMemoria(ids, upd);
  document.getElementById('edit-active-modal').classList.add('hidden');
  recalcularTudo();
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').update(upd).in('id', ids), 5000);
  } catch (e) {
    await NovaEraOffline.enqueue({ tipo: 'APOIO_UPD', ids, payload: upd });
    atualizarBotaoFilaOffline();
  }
}

async function desfazerInicioTarefaAtiva() {
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para cancelar o início de uma tarefa."); return; }
  if (!loteEditandoAtivo || !confirm("Deseja cancelar o início desta atividade e voltar para Pendente?")) return;
  await sb.from('execucoes_auditoria').delete().in('id', obterIdsLote(loteEditandoAtivo));
  document.getElementById('edit-active-modal').classList.add('hidden');
  carregarDadosSupabase();
}

function abrirModalProgressoLote(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) { alert("🔒 Apenas quem abriu a tarefa pode anexar fotos."); return; }
  loteProgresso = lote;
  const reg = lote.principal;
  tarefasSelecionadasLote = [{ setor: reg.setor, atividade: reg.atividade }];
  fotosAtuaisProgresso = extrairListaFotos(reg.foto_antes_url).map(u => ({ tipo: 'URL', valor: u }));
  document.getElementById('prog-task-title').textContent = `${reg.setor} • ${reg.atividade}`;
  document.getElementById('prog-obs-input').value = reg.observacao === 'Atividade em andamento...' ? '' : (reg.observacao || '');
  renderizarGridFotosProgresso();
  document.getElementById('progresso-modal').classList.remove('hidden');
  initIcons();
}
function fecharModalProgresso() { loteProgresso = null; document.getElementById('progresso-modal').classList.add('hidden'); }
function renderizarGridFotosProgresso() {
  document.getElementById('prog-fotos-grid').innerHTML = fotosAtuaisProgresso.map((f, i) => `<div class="relative h-24 rounded-xl overflow-hidden border border-slate-200"><img src="${f.valor}" class="w-full h-full object-cover">${i > 0 ? `<button onclick="removerFotoProgresso(${i})" class="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1"><i data-lucide="x" class="w-3 h-3"></i></button>` : ''}<span class="absolute bottom-1 left-1 bg-slate-900/80 text-white text-[7px] font-bold px-1.5 py-0.5 rounded">ANDAMENTO</span></div>`).join('');
  document.getElementById('prog-botoes-camera').classList.toggle('hidden', fotosAtuaisProgresso.length >= 3);
  initIcons();
}
function removerFotoProgresso(idx) { fotosAtuaisProgresso.splice(idx, 1); renderizarGridFotosProgresso(); }
async function salvarProgressoMeioCaminho() {
  if (!loteProgresso) return;
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para enviar fotos de andamento."); return; }
  const btn = document.getElementById('btn-salvar-progresso');
  btn.disabled = true; btn.textContent = "Enviando...";
  try {
    const urlsFinais = [];
    for (const item of fotosAtuaisProgresso) urlsFinais.push(item.tipo === 'URL' ? item.valor : await uploadBase64Storage(item.valor, 'INICIAL_ANDAMENTO'));
    await sb.from('execucoes_auditoria').update({ foto_antes_url: urlsFinais.join('|'), observacao: document.getElementById('prog-obs-input').value.trim() || 'Atividade em andamento...' }).in('id', obterIdsLote(loteProgresso));
    fecharModalProgresso(); carregarDadosSupabase();
  } catch (e) { alert("Erro ao atualizar registro."); }
  finally { btn.disabled = false; btn.textContent = "Salvar Fotos no Registro"; }
}

// =========================================================================
// 4. DISPENSA TÉCNICA / IMPEDIMENTO EPI
// =========================================================================
function alternarTipoSkip(tipo) {
  tipoSkipAtivo = tipo; const isV = tipo === 'VISTORIA';
  document.getElementById('btn-skip-tipo-VISTORIA').className = isV ? "py-2 px-2 rounded-lg text-[11px] font-extrabold bg-sky-600 text-white shadow-sm" : "py-2 px-2 rounded-lg text-[11px] font-extrabold text-slate-600";
  document.getElementById('btn-skip-tipo-EPI').className = !isV ? "py-2 px-2 rounded-lg text-[11px] font-extrabold bg-amber-500 text-slate-950 shadow-sm" : "py-2 px-2 rounded-lg text-[11px] font-extrabold text-slate-600";
  document.getElementById('bloco-skip-vistoria').classList.toggle('hidden', !isV);
  document.getElementById('bloco-skip-epi').classList.toggle('hidden', isV);
  const btnS = document.getElementById('btn-salvar-skip');
  btnS.className = isV ? "w-full bg-sky-600 hover:bg-sky-700 text-white font-extrabold py-3 rounded-xl flex justify-center items-center gap-2 shadow-md text-xs" : "w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold py-3 rounded-xl flex justify-center items-center gap-2 shadow-md text-xs";
  btnS.textContent = isV ? "Confirmar Vistoria e Dispensar Hoje" : "⚠️ Reportar Falta de EPI e Pedir ao Supervisor";
}
function abrirModalSkip(itensArray, iniciarEmEpi = false) {
  tarefasSelecionadasLote = itensArray; dadosFotoSkip = null;
  const prim = itensArray[0];
  document.getElementById('skip-task-title').textContent = `${prim.setor} • ${prim.atividade}`;
  document.getElementById('skip-especies-alvo').textContent = `🌿 Espécies: ${itensArray.map(i => i.especie || 'Geral').join(', ')}`;
  document.getElementById('skip-obs-input').value = ''; document.getElementById('input-epi-detalhe').value = '';
  document.getElementById('skip-preview-container').classList.add('hidden');
  alternarTipoSkip(iniciarEmEpi ? 'EPI' : 'VISTORIA');
  document.getElementById('skip-modal').classList.remove('hidden'); initIcons();
}
function fecharModalSkip() { document.getElementById('skip-modal').classList.add('hidden'); }

async function confirmarDispensaTecnica() {
  const btn = document.getElementById('btn-salvar-skip');
  const prim = tarefasSelecionadasLote[0];
  const grupoId = tarefasSelecionadasLote.length > 1 ? `GRP_${Date.now()}_${Math.floor(Math.random() * 1000)}` : null;
  const meuNome = window.usuarioLogado?.nome || 'Operador';
  const meuUid = window.usuarioLogado?.auth_user_id || null;

  if (tipoSkipAtivo === 'EPI') {
    const epiSel = document.getElementById('select-epi-faltante').value;
    const detalhe = document.getElementById('input-epi-detalhe').value.trim();
    const epiItem = epiSel === '__OUTRO__' ? detalhe : epiSel;
    if (!epiItem) { alert("Informe qual EPI ou equipamento está faltando."); return; }

    const catItemObj = window.catalogoSuprimentosDB.find(c => c.nome === epiItem);
    const catPedido = catItemObj ? catItemObj.categoria : 'EPI';

    btn.disabled = true; btn.textContent = "Notificando supervisão...";
    try {
      await sb.from('pedidos_suprimentos').insert([{
        cliente: clienteAtivo, solicitante: meuNome, solicitante_auth_id: meuUid,
        categoria: catPedido, area_destino: prim.setor, item: epiItem,
        quantidade_calculada: `1 ${catItemObj?.unidade_exibicao || 'un'}`,
        observacao: `Impedimento na tarefa "${prim.atividade}".${epiSel !== '__OUTRO__' && detalhe ? ' ' + detalhe : ''}`,
        urgente: true, origem_impedimento: true, status_pedido: 'SOLICITADO'
      }]);

      const proxDia = proximoDiaUtilISO();
      const insertsAud = [];
      for (const t of tarefasSelecionadasLote) {
        if (t.id && t.data_alvo) await sb.from('cronograma_mestre').update({ data_alvo: proxDia }).eq('id', t.id);
        else await sb.from('cronograma_mestre').insert([{ cliente: clienteAtivo, setor: t.setor, ambiente: 'Reprogramado EPI', atividade: t.atividade, frequencia: 'Transbordo', duracao_str: t.duracao_str || '30m', duracao_minutos: Number(t.duracao_minutos) || 30, especie: t.especie || 'Geral', permite_chuva: t.permite_chuva !== false, vital: Boolean(t.vital), prioridade: 1, data_alvo: proxDia }]);

        insertsAud.push({
          tarefa_id: t.id || null, data_referencia: dataISO(), cliente: clienteAtivo, setor: t.setor, atividade: t.atividade,
          especie: t.especie || 'Geral', grupo_execucao_id: grupoId, equipe_executora: meuNome,
          registrado_por: meuNome, responsavel_auth_id: meuUid,
          observacao: `[IMPEDIMENTO DE SEGURANÇA] Falta de ${epiItem}. Pedido urgente aberto e tarefa reprogramada.`,
          dh_inicio_tarefa: new Date().toISOString(), dh_envio_servidor: new Date().toISOString(),
          duracao_estimada_min: Number(t.duracao_minutos) || 30, duracao_real_min: 0,
          flag_auditoria: 'DIVERGENCIA_SLA', status_execucao: 'IMPEDIMENTO_EPI'
        });
      }
      await sb.from('execucoes_auditoria').insert(insertsAud);
      fecharModalSkip();
      alert(`✅ Pedido urgente de "${epiItem}" enviado ao Supervisor!`);
      carregarDadosSupabase();
    } catch (e) { alert("Erro ao enviar impedimento."); }
    finally { btn.disabled = false; }
    return;
  }

  const motivo = document.getElementById('skip-obs-input').value.trim();
  if (motivo.length < 10) { alert("Selecione ou descreva o motivo técnico."); return; }
  if (!dadosFotoSkip) { alert("Capture a foto de vistoria local."); return; }
  btn.disabled = true; btn.textContent = "Registrando vistoria...";
  try {
    const urlVistoria = await uploadBase64Storage(dadosFotoSkip.base64, 'VISTORIA_DISPENSA');
    const insertsVist = tarefasSelecionadasLote.map(t => ({
      tarefa_id: t.id || null, data_referencia: dataISO(), cliente: clienteAtivo, setor: t.setor, atividade: t.atividade,
      especie: t.especie || 'Geral', grupo_execucao_id: grupoId, equipe_executora: meuNome,
      registrado_por: meuNome, responsavel_auth_id: meuUid, observacao: `[DISPENSADO POR VISTORIA] ${motivo}`,
      foto_antes_url: urlVistoria, foto_depois_url: urlVistoria, hash_foto_depois: dadosFotoSkip.hash,
      dh_inicio_tarefa: dadosFotoSkip.dh_exif, dh_captura_exif: dadosFotoSkip.dh_exif, dh_envio_servidor: new Date().toISOString(),
      duracao_estimada_min: Number(t.duracao_minutos) || 30, duracao_real_min: 2,
      origem_midia: dadosFotoSkip.origem, aparelho_modelo: dadosFotoSkip.modelo,
      lat_captura: gpsAtual.lat, lng_captura: gpsAtual.lng, precisao_gps_m: gpsAtual.acc, distancia_cliente_m: gpsAtual.distCliente,
      flag_auditoria: 'CONFORME', status_execucao: 'DISPENSADO'
    }));
    await sb.from('execucoes_auditoria').insert(insertsVist);
    hashesConhecidos.add(dadosFotoSkip.hash);
    localStorage.setItem('novaera_hashes_fotos', JSON.stringify(Array.from(hashesConhecidos)));
    fecharModalSkip(); carregarDadosSupabase();
  } catch (e) { alert("Erro ao registrar vistoria."); }
  finally { btn.disabled = false; btn.textContent = "Confirmar Vistoria e Dispensar Hoje"; }
}

// =========================================================================
// 5. CÂMERA, CONCLUSÃO OFFLINE (INDEXEDDB) E GATILHO DE TAREFAS DEPENDENTES
// =========================================================================
function confirmarEpiEAbrirCamera() { document.getElementById('epi-alert-modal').classList.add('hidden'); abrirSeletorArquivoCamera(origemCaptura); }
function reportarFaltaEpiDoAlerta() { document.getElementById('epi-alert-modal').classList.add('hidden'); abrirModalSkip(tarefasSelecionadasLote, true); }
function abrirSeletorArquivoCamera(origem) { document.getElementById(origem === 'CAMERA_APP' ? 'camera-live-input' : 'gallery-exif-input').click(); }
function dispararCamera(etapa, origem) { etapaCaptura = etapa; origemCaptura = origem; abrirSeletorArquivoCamera(origem); }

async function calcularHashSHA256(file) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function registrarRejeicaoSilenciosa(motivo, detalhes, modeloAparelho) {
  alert("⚠️ Falha ao processar o arquivo de imagem (Erro 422). Tente capturar novamente.");
  if (navigator.onLine) {
    const prim = tarefasSelecionadasLote[0] || loteAtivoSelecionado?.principal;
    try {
      await sb.from('logs_rejeicao').insert([{
        cliente: clienteAtivo, operador: window.usuarioLogado?.nome || 'Operador',
        setor: prim?.setor || 'Geral', atividade: prim?.atividade || 'Geral',
        motivo_tecnico: motivo, detalhes_exif: detalhes, aparelho_info: modeloAparelho || navigator.userAgent.slice(0, 80)
      }]);
    } catch (e) {}
  }
}

function estamparMarcaDagua(file, textoRodape) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1080; let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h *= maxDim / w; w = maxDim; } else if (h > maxDim) { w *= maxDim / h; h = maxDim; }
        canvas.width = Math.round(w); canvas.height = Math.round(h);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)"; ctx.fillRect(0, canvas.height - 38, canvas.width, 38);
        ctx.fillStyle = "#f8fafc"; ctx.font = "bold 13px Inter, sans-serif"; ctx.fillText(textoRodape, 12, canvas.height - 14);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadBase64Storage(base64Str, prefixo) {
  const blob = await (await fetch(base64Str)).blob();
  const fileName = `${clienteAtivo.replace(/\s+/g, '_')}/${dataISO()}_${prefixo}_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
  const { error } = await sb.storage.from('auditoria-fotos').upload(fileName, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from('auditoria-fotos').getPublicUrl(fileName).data.publicUrl;
}

async function processarArquivoImagem(file, origem) {
  if (!file) return;
  const hash = await calcularHashSHA256(file);
  if (hashesConhecidos.has(hash)) { await registrarRejeicaoSilenciosa('HASH_DUPLICADO', `Hash SHA-256 repetido: ${hash.slice(0, 16)}`, null); return; }

  let dhCapturaExif = new Date(), modeloCamera = "Camera Nativa Web";
  if (origem === 'GALERIA_EXIF') {
    let exif = null; try { exif = await exifr.parse(file); } catch (e) {}
    if (!exif || (!exif.DateTimeOriginal && !exif.CreateDate)) { await registrarRejeicaoSilenciosa('METADADO_AUSENTE_WHATSAPP', `Sem EXIF: ${file.name}`, null); return; }
    dhCapturaExif = new Date(exif.DateTimeOriginal || exif.CreateDate);
    modeloCamera = [exif.Make, exif.Model].filter(Boolean).join(' ') || 'EXIF Verificado';
    if (dataISO(dhCapturaExif) !== dataISO(new Date())) { await registrarRejeicaoSilenciosa('FOTO_DATA_ANTIGA', `EXIF: ${dhCapturaExif.toLocaleString('pt-BR')}`, modeloCamera); return; }
  }

  const meuNome = window.usuarioLogado?.nome || 'Op';
  const rodapeWatermark = `${dhCapturaExif.toLocaleString('pt-BR')} | ${clienteAtivo} (${gpsAtual.distCliente !== null ? gpsAtual.distCliente + 'm' : 'Subsolo'}) | ${meuNome}`;
  const base64Carimbado = await estamparMarcaDagua(file, rodapeWatermark);

  if (etapaCaptura === 'skip') {
    dadosFotoSkip = { base64: base64Carimbado, hash, dh_exif: dhCapturaExif.toISOString(), modelo: modeloCamera, origem };
    document.getElementById('skip-preview-container').classList.remove('hidden');
    document.getElementById('skip-foto-preview').src = base64Carimbado; return;
  }
  if (etapaCaptura === 'progresso') {
    if (fotosAtuaisProgresso.length < 3) {
      fotosAtuaisProgresso.push({ tipo: 'B64', valor: base64Carimbado });
      hashesConhecidos.add(hash); localStorage.setItem('novaera_hashes_fotos', JSON.stringify(Array.from(hashesConhecidos)));
      renderizarGridFotosProgresso();
    } return;
  }
  if (etapaCaptura === 'edicao_concluida') {
    if (fotosEdicaoConcluida.length < 3) {
      fotosEdicaoConcluida.push({ tipo: 'B64', valor: base64Carimbado });
      hashesConhecidos.add(hash); localStorage.setItem('novaera_hashes_fotos', JSON.stringify(Array.from(hashesConhecidos)));
      renderizarGridFotosEdicaoConcluida();
    } return;
  }
  if (etapaCaptura === 'antes') {
    if (!navigator.onLine) { alert("📵 Sem sinal para iniciar tarefa. Volte à superfície."); return; }
    const grupoId = tarefasSelecionadasLote.length > 1 ? `GRP_${Date.now()}_${Math.floor(Math.random() * 1000)}` : null;
    try {
      const urlAntes = await NovaEraOffline.withTimeout(uploadBase64Storage(base64Carimbado, 'INICIAL'), 15000);
      const insertsIni = tarefasSelecionadasLote.map(t => ({
        tarefa_id: t.id || null, data_referencia: dataISO(), cliente: clienteAtivo, setor: t.setor, atividade: t.atividade,
        especie: t.especie || 'Geral', grupo_execucao_id: grupoId,
        equipe_executora: meuNome, registrado_por: meuNome,
        responsavel_auth_id: window.usuarioLogado?.auth_user_id || null,
        participantes: [],
        observacao: 'Atividade em andamento...', foto_antes_url: urlAntes,
        dh_inicio_tarefa: dhCapturaExif.toISOString(), duracao_estimada_min: Number(t.duracao_minutos) || 30,
        status_execucao: 'EM_ANDAMENTO', minutos_pausa_descontados: 0, flag_auditoria: 'CONFORME'
      }));
      await NovaEraOffline.withTimeout(sb.from('execucoes_auditoria').insert(insertsIni), 10000);
      hashesConhecidos.add(hash); localStorage.setItem('novaera_hashes_fotos', JSON.stringify(Array.from(hashesConhecidos)));
      await carregarDadosSupabase();
    } catch (e) {
      alert("📵 Sinal muito fraco para iniciar a tarefa. Tente novamente com sinal estável.");
    }
  } else if (listaFotosDepois.length < 3) {
    listaFotosDepois.push({ base64: base64Carimbado, hash, dh_exif: dhCapturaExif.toISOString(), modelo: modeloCamera, origem });
    renderizarGridFotosDepois();
  }
}

function renderizarGridFotosDepois() {
  const grid = document.getElementById('depois-fotos-grid'), botoes = document.getElementById('botoes-captura-depois');
  document.getElementById('contador-fotos-depois').textContent = `${listaFotosDepois.length}/3 fotos`;
  if (listaFotosDepois.length === 0) { grid.classList.add('hidden'); botoes.classList.remove('hidden'); document.getElementById('box-contingencia').classList.add('hidden'); return; }
  grid.classList.remove('hidden');
  grid.innerHTML = listaFotosDepois.map((f, i) => `<div class="relative h-24 rounded-xl overflow-hidden border border-slate-200"><img src="${f.base64}" class="w-full h-full object-cover"><button type="button" onclick="removerFotoDepois(${i})" class="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1"><i data-lucide="x" class="w-3 h-3"></i></button><span class="absolute bottom-1 left-1 bg-slate-900/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">DEPOIS ${i + 1}</span></div>`).join('');
  botoes.classList.toggle('hidden', listaFotosDepois.length >= 3);
  document.getElementById('box-contingencia').classList.toggle('hidden', !listaFotosDepois.some(f => f.origem === 'GALERIA_EXIF'));
  initIcons();
}
function removerFotoDepois(idx) { listaFotosDepois.splice(idx, 1); renderizarGridFotosDepois(); }

document.getElementById('camera-live-input').addEventListener('change', e => { processarArquivoImagem(e.target.files[0], 'CAMERA_APP'); e.target.value = ''; });
document.getElementById('gallery-exif-input').addEventListener('change', e => { processarArquivoImagem(e.target.files[0], 'GALERIA_EXIF'); e.target.value = ''; });

function abrirModalConclusaoLote(lIdx) {
  const lote = window.lotesAtivosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) {
    alert("🔒 Apenas quem abriu a tarefa pode concluí-la.");
    return;
  }
  loteAtivoSelecionado = lote;
  listaFotosDepois = []; renderizarGridFotosDepois();
  const e = lote.principal;
  const somaEst = lote.registros.reduce((acc, r) => acc + (Number(r.duracao_estimada_min) || 30), 0);

  document.getElementById('modal-task-title').textContent = e.atividade;
  document.getElementById('modal-setor-title').textContent = `${e.setor} • Meta Total: ${formatarMinutosStr(somaEst)}`;
  document.getElementById('chk-entrega-parcial').checked = false;
  document.getElementById('obs-input').value = '';

  const boxEsp = document.getElementById('box-especies-conclusao');
  if (lote.registros.length > 1) {
    boxEsp.classList.remove('hidden');
    document.getElementById('lista-especies-conclusao').innerHTML = lote.registros.map(r => `
      <label class="flex items-center gap-1.5 bg-white border border-emerald-300 px-2.5 py-1 rounded-lg cursor-pointer text-xs font-bold text-slate-800">
        <input type="checkbox" value="${r.id}" checked class="w-3.5 h-3.5 text-emerald-600 rounded">
        <span>${r.especie || 'Geral'}</span>
      </label>`).join('');
  } else boxEsp.classList.add('hidden');

  if (somaEst > 180) {
    document.getElementById('box-fatiamento').classList.remove('hidden');
    document.getElementById('input-minutos-parciais').value = Math.min(120, somaEst);
  } else document.getElementById('box-fatiamento').classList.add('hidden');

  document.getElementById('conclusion-modal').classList.remove('hidden'); initIcons();
}
function setMinutosParciais(m) { document.getElementById('input-minutos-parciais').value = m; }
function closeConclusionModal() { document.getElementById('conclusion-modal').classList.add('hidden'); }

async function dispararTarefasDependentes(regConcluido) {
  if (!regConcluido || !Array.isArray(window.regrasDependenciaDB) || window.regrasDependenciaDB.length === 0) return;
  const normAtiv = normalizarTexto(regConcluido.atividade);
  const regrasBatem = window.regrasDependenciaDB.filter(rg => {
    if (rg.cliente !== clienteAtivo || rg.ativo === false) return false;
    const kws = String(rg.palavras_chave_gatilho || '').split(',').map(k => normalizarTexto(k.trim())).filter(Boolean);
    return kws.some(k => normAtiv.includes(k));
  });

  for (const rg of regrasBatem) {
    const dataAlvo = somarDiasCorridosEmpurrandoFDS(rg.prazo_dias_corridos);
    const durMin = Number(rg.duracao_padrao_min) || 30;
    try {
      const { data: existe } = await sb.from('cronograma_mestre')
        .select('id')
        .eq('tarefa_origem_execucao_id', regConcluido.id)
        .eq('regra_dependencia_id', rg.id)
        .limit(1);
      if (existe && existe.length > 0) continue;

      await sb.from('cronograma_mestre').insert([{
        cliente: clienteAtivo, setor: regConcluido.setor, ambiente: 'Dependente',
        atividade: rg.atividade_filha, frequencia: 'Dependente',
        duracao_str: formatarMinutosStr(durMin), duracao_minutos: durMin,
        especie: regConcluido.especie || 'Geral', permite_chuva: Boolean(rg.permite_chuva),
        prioridade: 1, data_alvo: dataAlvo, vital: false,
        tarefa_origem_execucao_id: regConcluido.id, regra_dependencia_id: rg.id
      }]);
    } catch (e) {}
  }
}

async function finalizarProcesso() {
  if (!loteAtivoSelecionado) return;
  if (listaFotosDepois.length === 0) { alert("Capture ao menos 1 foto de conclusão."); return; }
  const obs = document.getElementById('obs-input').value.trim();
  if (obs.length < 10 || obs.split(/\s+/).length < 2 || !/[aeiouáéíóúãõâêô]/i.test(obs)) {
    alert("Digite uma observação válida (mínimo de 2 palavras reais).");
    return;
  }

  let idsConcluidos = loteAtivoSelecionado.registros.map(r => r.id);
  if (loteAtivoSelecionado.registros.length > 1) {
    idsConcluidos = Array.from(document.querySelectorAll('#lista-especies-conclusao input:checked')).map(c => Number(c.value));
    if (idsConcluidos.length === 0) { alert("Marque ao menos uma espécie concluída."); return; }
  }
  const regsConcluidos = loteAtivoSelecionado.registros.filter(r => idsConcluidos.includes(r.id));
  const regsDevolvidos = loteAtivoSelecionado.registros.filter(r => !idsConcluidos.includes(r.id));

  const btn = document.getElementById('btn-salvar'); btn.disabled = true; btn.textContent = "Salvando...";

  const ultimaFoto = listaFotosDepois[listaFotosDepois.length - 1];
  const temGaleria = listaFotosDepois.some(f => f.origem === 'GALERIA_EXIF');
  const regRef = loteAtivoSelecionado.principal;
  const dhInicio = new Date(regRef.dh_inicio_tarefa);
  const dhFimExif = new Date(ultimaFoto.dh_exif), dhAgora = new Date();

  let minPausas = Number(regRef.minutos_pausa_descontados) || 0;
  if (regRef.status_execucao === 'PAUSADO' && regRef.dh_inicio_pausa) {
    minPausas += Math.max(0, Math.round((Date.now() - new Date(regRef.dh_inicio_pausa).getTime()) / 60000));
  }

  let duracaoTotalRealMin = Math.max(1, Math.max(1, Math.round((dhFimExif - dhInicio) / 60000)) - minPausas);
  const somaEstConcluidos = regsConcluidos.reduce((acc, r) => acc + (Number(r.duracao_estimada_min) || 30), 0);
  if (somaEstConcluidos > 180) {
    const inf = parseInt(document.getElementById('input-minutos-parciais').value, 10);
    if (inf > 0) duracaoTotalRealMin = inf;
  }

  // Fecha automaticamente o horário de qualquer apoio que ainda esteja aberto
  const participantesFechados = obterParticipantesLista(regRef).map(p => p.fim ? p : { ...p, fim: dhFimExif.toISOString() });
  const equipeFinalTxt = montarEquipeExecutoraTexto(regRef, participantesFechados);

  const deltaEnvioMin = Math.max(0, Math.round((dhAgora - dhFimExif) / 60000));
  const isParcial = document.getElementById('chk-entrega-parcial').checked;

  let flag = 'CONFORME';
  if (gpsAtual.suspeitoFake) flag = 'SINAL_GPS_ATIPICO';
  else if (gpsAtual.distCliente !== null && gpsAtual.distCliente > 450) flag = 'FORA_PERIMETRO';
  else if (deltaEnvioMin > 15 || temGaleria) flag = 'ENVIO_DEFASADO';
  else if (!isParcial && somaEstConcluidos >= 30 && duracaoTotalRealMin < Math.round(somaEstConcluidos * 0.2)) flag = 'DIVERGENCIA_SLA';

  const baseUpdate = {
    data_referencia: dataISO(),
    equipe_executora: equipeFinalTxt,
    registrado_por: regRef.registrado_por || window.usuarioLogado?.nome || 'Operador',
    participantes: participantesFechados,
    observacao: isParcial ? `[ENTREGA PARCIAL] ${obs}` : obs,
    justificativa_contingencia: temGaleria ? document.getElementById('select-contingencia').value : null,
    hash_foto_depois: ultimaFoto.hash,
    dh_captura_exif: dhFimExif.toISOString(),
    dh_envio_servidor: dhAgora.toISOString(),
    minutos_pausa_descontados: minPausas,
    delta_envio_min: deltaEnvioMin,
    origem_midia: temGaleria ? 'GALERIA_EXIF' : 'CAMERA_APP',
    aparelho_modelo: ultimaFoto.modelo,
    lat_captura: gpsAtual.lat, lng_captura: gpsAtual.lng,
    precisao_gps_m: gpsAtual.acc, distancia_cliente_m: gpsAtual.distCliente,
    flag_auditoria: flag, status_execucao: 'CONCLUIDO',
    entrega_parcial: isParcial, motivo_pausa: null, dh_inicio_pausa: null
  };

  let salvouOffline = false;
  try {
    if (!navigator.onLine) throw new Error("OFFLINE");
    const urlsDepoisArr = [];
    for (const f of listaFotosDepois) urlsDepoisArr.push(await NovaEraOffline.withTimeout(uploadBase64Storage(f.base64, 'DEPOIS'), 15000));
    const fotoDepoisStr = urlsDepoisArr.join('|');

    if (regsDevolvidos.length > 0) {
      await sb.from('execucoes_auditoria').delete().in('id', regsDevolvidos.map(r => r.id));
    }

    for (const r of regsConcluidos) {
      const peso = (Number(r.duracao_estimada_min) || 30) / Math.max(1, somaEstConcluidos);
      const tempoRateado = regsConcluidos.length === 1 ? duracaoTotalRealMin : Math.max(1, Math.round(duracaoTotalRealMin * peso));
      await sb.from('execucoes_auditoria').update({ ...baseUpdate, foto_depois_url: fotoDepoisStr, duracao_real_min: tempoRateado }).eq('id', r.id);

      if (isParcial && (Number(r.duracao_estimada_min) || 30) <= 180) {
        const saldoMin = Math.max(15, (Number(r.duracao_estimada_min) || 30) - tempoRateado);
        const nomeCont = r.atividade.startsWith('Continuação:') ? r.atividade : `Continuação: ${r.atividade}`;
        await sb.from('cronograma_mestre').insert([{ cliente: clienteAtivo, setor: r.setor, ambiente: 'Transbordo', atividade: nomeCont, frequencia: 'Transbordo', duracao_str: formatarMinutosStr(saldoMin), duracao_minutos: saldoMin, especie: r.especie || 'Geral', permite_chuva: true, prioridade: 1, data_alvo: proximoDiaUtilISO() }]);
      } else if (!isParcial) {
        await dispararTarefasDependentes(r);
      }
    }
  } catch (err) {
    salvouOffline = true;
    await NovaEraOffline.enqueue({
      tipo: 'CONCLUIR_LOTE',
      cliente: clienteAtivo,
      idsDevolver: regsDevolvidos.map(r => r.id),
      regsConcluidos: regsConcluidos.map(r => ({
        id: r.id, setor: r.setor, atividade: r.atividade, especie: r.especie,
        duracao_estimada_min: Number(r.duracao_estimada_min) || 30,
        peso: (Number(r.duracao_estimada_min) || 30) / Math.max(1, somaEstConcluidos)
      })),
      duracaoTotalRealMin,
      isParcial,
      baseUpdate,
      fotosDepoisB64: listaFotosDepois.map(f => f.base64)
    });

    // Atualiza na memória + snapshot local para já sair de "Em Execução" mesmo no subsolo
    atualizarRegistrosEmMemoria(regsConcluidos.map(r => r.id), { ...baseUpdate, duracao_real_min: duracaoTotalRealMin, foto_depois_url: ultimaFoto.base64 });
    if (regsDevolvidos.length > 0) {
      const delIds = regsDevolvidos.map(r => r.id);
      window.execucoesMesDB = window.execucoesMesDB.filter(e => !delIds.includes(e.id));
      salvarSnapshotLocalAtual();
    }
    await atualizarBotaoFilaOffline();
  }

  listaFotosDepois.forEach(f => hashesConhecidos.add(f.hash));
  localStorage.setItem('novaera_hashes_fotos', JSON.stringify(Array.from(hashesConhecidos)));
  btn.disabled = false; btn.textContent = "Salvar e Sincronizar";
  closeConclusionModal();

  if (salvouOffline) {
    recalcularTudo();
    mostrarToastFlutuante('📦 Salvo na Fila Offline', 'As fotos serão enviadas automaticamente quando o sinal voltar.', null);
  } else {
    carregarDadosSupabase();
  }
}

// =========================================================================
// 6. SINCRONIZAÇÃO DA FILA OFFLINE (INDEXEDDB)
// =========================================================================
async function sincronizarFilaOffline() {
  if (!navigator.onLine) return;
  const fila = await NovaEraOffline.getQueue();
  if (fila.length === 0) { atualizarBotaoFilaOffline(); return; }

  const btn = document.getElementById('btn-sync-queue');
  if (btn) btn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Sync...`;
  initIcons();

  for (const item of fila) {
    try {
      if (item.tipo === 'CHECKIN_NOVO') {
        await sb.from('presenca_posto').delete().eq('data_turno', item.data_turno).eq('cliente', item.cliente);
        const { data } = await sb.from('presenca_posto').insert([item.payload]).select();
        if (data?.[0]) NovaEraOffline.saveCheckinLocal(item.cliente, item.data_turno, data[0]);
      } else if (item.tipo === 'CHECKIN_UPD') {
        if (item.id) await sb.from('presenca_posto').update(item.payload).eq('id', item.id);
        else await sb.from('presenca_posto').update(item.payload).eq('data_turno', item.data_turno).eq('cliente', item.cliente);
      } else if (['PAUSA_LOTE', 'RETOMA_LOTE', 'APOIO_UPD'].includes(item.tipo)) {
        await sb.from('execucoes_auditoria').update(item.payload).in('id', item.ids);
      } else if (item.tipo === 'CONCLUIR_LOTE') {
        const urls = [];
        for (const b64 of (item.fotosDepoisB64 || [])) urls.push(await uploadBase64Storage(b64, 'DEPOIS_OFF'));
        const fotoStr = urls.join('|');
        if (item.idsDevolver?.length > 0) await sb.from('execucoes_auditoria').delete().in('id', item.idsDevolver);

        for (const r of (item.regsConcluidos || [])) {
          const tempoRateado = item.regsConcluidos.length === 1 ? item.duracaoTotalRealMin : Math.max(1, Math.round(item.duracaoTotalRealMin * r.peso));
          await sb.from('execucoes_auditoria').update({ ...item.baseUpdate, foto_depois_url: fotoStr, duracao_real_min: tempoRateado }).eq('id', r.id);

          if (item.isParcial && r.duracao_estimada_min <= 180) {
            const saldoMin = Math.max(15, r.duracao_estimada_min - tempoRateado);
            const nomeCont = r.atividade.startsWith('Continuação:') ? r.atividade : `Continuação: ${r.atividade}`;
            await sb.from('cronograma_mestre').insert([{ cliente: item.cliente, setor: r.setor, ambiente: 'Transbordo', atividade: nomeCont, frequencia: 'Transbordo', duracao_str: formatarMinutosStr(saldoMin), duracao_minutos: saldoMin, especie: r.especie || 'Geral', permite_chuva: true, prioridade: 1, data_alvo: proximoDiaUtilISO() }]);
          } else if (!item.isParcial) {
            await dispararTarefasDependentes(r);
          }
        }
      }
      await NovaEraOffline.removeQueueItem(item.qid);
    } catch (e) {
      console.warn('Falha ao sincronizar item da fila:', item.tipo, e);
    }
  }

  await atualizarBotaoFilaOffline();
  carregarDadosSupabase();
}

async function atualizarBotaoFilaOffline() {
  const qtd = await NovaEraOffline.countQueue();
  const btn = document.getElementById('btn-sync-queue');
  if (!btn) return;
  if (qtd > 0) {
    btn.classList.remove('hidden');
    btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> <span id="sync-count">${qtd} pend.</span>`;
    initIcons();
  } else {
    btn.classList.add('hidden');
  }
}

// =========================================================================
// 7. CORRIGIR CONCLUÍDA HOJE & NOVA TAREFA EXTRA
// =========================================================================
function abrirModalEdicaoLoteConcluido(lIdx) {
  if (window.presencaHojeDB?.status_validacao === 'TURNO_ENCERRADO') { alert("🔒 Expediente encerrado."); return; }
  const lote = window.lotesResolvidosCache[lIdx];
  if (!lote || !souDonoTarefa(lote.principal)) { alert("🔒 Apenas quem concluiu a tarefa pode editá-la."); return; }
  loteEditandoConcluido = lote;
  const reg = lote.principal;
  const espTxt = lote.registros.map(r => r.especie).filter(Boolean).join(', ');
  document.getElementById('edit-conc-title').textContent = `${reg.setor} • ${reg.atividade}${espTxt ? ' (' + espTxt + ')' : ''}`;
  document.getElementById('edit-conc-obs').value = reg.observacao || '';
  fotosEdicaoConcluida = extrairListaFotos(reg.foto_depois_url).map(u => ({ tipo: 'URL', valor: u }));
  renderizarGridFotosEdicaoConcluida();
  document.getElementById('edit-concluded-modal').classList.remove('hidden'); initIcons();
}
function fecharModalEdicaoConcluida() { loteEditandoConcluido = null; document.getElementById('edit-concluded-modal').classList.add('hidden'); }
function renderizarGridFotosEdicaoConcluida() {
  document.getElementById('edit-conc-fotos-grid').innerHTML = fotosEdicaoConcluida.map((f, i) => `<div class="relative h-24 rounded-xl overflow-hidden border border-slate-200"><img src="${f.valor}" class="w-full h-full object-cover">${fotosEdicaoConcluida.length > 1 ? `<button type="button" onclick="removerFotoEdicaoConcluida(${i})" class="absolute top-1 right-1 bg-red-600 text-white rounded-full p-1"><i data-lucide="x" class="w-3 h-3"></i></button>` : ''}</div>`).join('');
  document.getElementById('edit-conc-botoes-foto').classList.toggle('hidden', fotosEdicaoConcluida.length >= 3); initIcons();
}
function removerFotoEdicaoConcluida(idx) { if (fotosEdicaoConcluida.length <= 1) return; fotosEdicaoConcluida.splice(idx, 1); renderizarGridFotosEdicaoConcluida(); }
async function salvarCorrecaoConcluida() {
  if (!loteEditandoConcluido) return;
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para salvar a correção."); return; }
  const obs = document.getElementById('edit-conc-obs').value.trim(); if (obs.length < 5) { alert("Preencha a observação."); return; }
  const btn = document.getElementById('btn-salvar-correcao'); btn.disabled = true; btn.textContent = "Salvando...";
  try {
    const urlsFinais = [];
    for (const item of fotosEdicaoConcluida) urlsFinais.push(item.tipo === 'URL' ? item.valor : await uploadBase64Storage(item.valor, 'DEPOIS_EDIT'));
    await sb.from('execucoes_auditoria').update({ observacao: obs, foto_depois_url: urlsFinais.join('|') }).in('id', obterIdsLote(loteEditandoConcluido));
    fecharModalEdicaoConcluida(); carregarDadosSupabase();
  } catch (e) { alert("Erro ao salvar alterações."); }
  finally { btn.disabled = false; btn.textContent = "Salvar Alterações"; }
}

function aoSelecionarTipoAtividadeExtra() {
  const val = document.getElementById('select-modal-tipo-atividade').value;
  const lbl = document.getElementById('label-modal-tarefa');
  const inp = document.getElementById('input-modal-tarefa');
  const dur = document.getElementById('input-modal-duracao');
  const chkVital = document.getElementById('input-modal-vital');

  if (val === '__OUTRA__') {
    lbl.innerHTML = `Descrição da Atividade <span class="text-red-500">*</span>`;
    inp.placeholder = 'Ex: Troca de vaso / Escoramento';
    chkVital.checked = false;
  } else {
    const tipoObj = window.tiposAtividadeDB.find(t => t.nome === val);
    lbl.textContent = 'Detalhe (Opcional)';
    inp.placeholder = 'Ex: Folhas secas / Lado esquerdo';
    if (tipoObj) { dur.value = Number(tipoObj.duracao_padrao_min) || 45; chkVital.checked = Boolean(tipoObj.vital_padrao); }
  }
}

function atualizarSugestoesEspecieExtra() {
  const setorDigitado = document.getElementById('input-modal-setor').value.trim();
  const dl = document.getElementById('especies-extra-list'); if (!dl) return;
  const filtradas = setorDigitado ? window.especiesClienteDB.filter(sp => normalizarTexto(sp.nome_area) === normalizarTexto(setorDigitado)) : window.especiesClienteDB;
  const listaFinal = filtradas.length > 0 ? filtradas : window.especiesClienteDB;
  dl.innerHTML = [...new Set(listaFinal.map(s => s.especie).filter(Boolean))].map(n => `<option value="${n}">`).join('');
}

function openExtraModal(preservarValores = false) {
  if (!preservarValores) {
    document.getElementById('input-modal-setor').value = '';
    document.getElementById('input-modal-tarefa').value = '';
    document.getElementById('input-modal-especie').value = '';
    const sel = document.getElementById('select-modal-tipo-atividade');
    if (sel && sel.options.length > 0) sel.selectedIndex = 0;
    aoSelecionarTipoAtividadeExtra(); atualizarSugestoesEspecieExtra();
  }
  document.getElementById('extra-modal').classList.remove('hidden'); initIcons();
}
function closeExtraModal() { document.getElementById('extra-modal').classList.add('hidden'); }

async function adicionarTarefaExtra() {
  if (postoBloqueadoHoje()) { alert("🔒 Posto fechado hoje."); return; }
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para criar uma tarefa extra."); return; }
  const setor = document.getElementById('input-modal-setor').value.trim();
  const tipoSel = document.getElementById('select-modal-tipo-atividade').value;
  const detalhe = document.getElementById('input-modal-tarefa').value.trim();
  const ativ = tipoSel === '__OUTRA__' ? detalhe : (detalhe ? `${tipoSel} — ${detalhe}` : tipoSel);
  const min = parseInt(document.getElementById('input-modal-duracao').value, 10) || 45;
  const especie = document.getElementById('input-modal-especie').value.trim() || 'Geral';
  const vital = document.getElementById('input-modal-vital').checked;
  if (!setor || !ativ) { alert("Preencha o Setor e a Atividade."); return; }
  await sb.from('cronograma_mestre').insert([{ cliente: clienteAtivo, setor, ambiente: 'Extra', atividade: ativ, frequencia: 'Extraordinária', duracao_str: formatarMinutosStr(min), duracao_minutos: min, especie, vital, permite_chuva: true, prioridade: vital ? 0 : 1, data_alvo: dataISO() }]);
  closeExtraModal(); carregarDadosSupabase();
}

// =========================================================================
// 8. SUPRIMENTOS E CHAT / REALTIME
// =========================================================================
function selecionarCategoriaSup(cat) {
  categoriaSuprimentoAtiva = cat;
  ['INSUMO', 'EPI', 'EQUIPAMENTO'].forEach(c => {
    document.getElementById(`btn-cat-${c}`).className = (c === cat)
      ? "py-2 px-1.5 rounded-xl text-[11px] font-extrabold bg-slate-900 text-white border border-slate-900"
      : "py-2 px-1.5 rounded-xl text-[11px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200";
  });
  const selItem = document.getElementById('sup-item-select');
  const itensCat = window.catalogoSuprimentosDB.filter(i => i.categoria === cat && i.ativo !== false);
  selItem.innerHTML = itensCat.map(i => `<option value="${i.nome}">${i.nome}</option>`).join('') + `<option value="__OUTRO__">➕ Outro item (especificar)</option>`;
  aoTrocarItemSuprimento();
}

function aoTrocarItemSuprimento() {
  const val = document.getElementById('sup-item-select').value;
  document.getElementById('sup-item-custom-box').classList.toggle('hidden', val !== '__OUTRO__');
  if (val !== '__OUTRO__') document.getElementById('sup-item-custom-input').value = '';
  recalcularInsumoPorMetragem();
}

function recalcularInsumoPorMetragem() {
  const boxInfo = document.getElementById('box-info-metragem-insumo'), qtdInput = document.getElementById('sup-qtd-input');
  const itemNome = document.getElementById('sup-item-select').value;
  if (itemNome === '__OUTRO__') { boxInfo.classList.add('hidden'); qtdInput.value = '1 un'; return; }

  const itemObj = window.catalogoSuprimentosDB.find(i => i.categoria === categoriaSuprimentoAtiva && i.nome === itemNome);
  const dose = Number(itemObj?.dose_por_m2) || 0, emb = Number(itemObj?.tamanho_embalagem) || 1, unid = itemObj?.unidade_exibicao || 'un';
  if (dose <= 0) { boxInfo.classList.add('hidden'); qtdInput.value = `1 ${unid}`; return; }

  const areaSel = document.getElementById('sup-area-select').value;
  const especiesAlvo = areaSel === 'Todo o Posto' ? window.especiesClienteDB : window.especiesClienteDB.filter(sp => sp.nome_area === areaSel);
  let areaTotalM2 = 0;
  especiesAlvo.forEach(sp => {
    const v = Number(sp.medida_valor) || 0;
    if (sp.medida_unidade === 'm linear') areaTotalM2 += v * 0.5;
    else if (sp.medida_unidade === 'un') areaTotalM2 += v * 0.25;
    else areaTotalM2 += v;
  });
  if (areaTotalM2 <= 0) areaTotalM2 = 20;

  let qtdCalc = emb > 1 ? `${Math.max(1, Math.ceil((areaTotalM2 * dose) / emb))} ${unid}` : (dose < 1 ? `${Math.max(0.2, areaTotalM2 * dose).toFixed(1)} ${unid}` : `${Math.max(1, Math.ceil(areaTotalM2 * dose))} ${unid}`);
  qtdInput.value = qtdCalc;
  boxInfo.classList.remove('hidden');
  boxInfo.textContent = `📐 Área estimada (${areaSel}): ~${Math.round(areaTotalM2)}m² → Dose sugerida: ${qtdCalc}`;
}

async function enviarPedidoSuprimento() {
  if (!navigator.onLine) { alert("📵 Conecte-se à internet para enviar um pedido."); return; }
  const itemSel = document.getElementById('sup-item-select').value;
  const itemFinal = itemSel === '__OUTRO__' ? document.getElementById('sup-item-custom-input').value.trim() : itemSel;
  if (!itemFinal) { alert("Especifique o nome do item."); return; }

  const btn = document.getElementById('btn-enviar-sup'); btn.disabled = true; btn.textContent = "Enviando...";
  await sb.from('pedidos_suprimentos').insert([{
    cliente: clienteAtivo, solicitante: window.usuarioLogado?.nome || 'Operador',
    solicitante_auth_id: window.usuarioLogado?.auth_user_id || null,
    categoria: categoriaSuprimentoAtiva, area_destino: document.getElementById('sup-area-select').value,
    item: itemFinal, quantidade_calculada: document.getElementById('sup-qtd-input').value.trim() || '1 un',
    observacao: document.getElementById('sup-obs-input').value.trim(),
    urgente: document.getElementById('sup-urgente-chk').checked, status_pedido: 'SOLICITADO'
  }]);
  document.getElementById('sup-obs-input').value = '';
  document.getElementById('sup-item-custom-input').value = '';
  document.getElementById('sup-urgente-chk').checked = false;
  btn.disabled = false; btn.textContent = "Enviar Pedido";
  carregarDadosSupabase();
}

function renderizarSuprimentos() {
  const lista = window.pedidosSuprimentosDB || [];
  const pendentes = lista.filter(p => !['ENTREGUE', 'NEGADO'].includes(p.status_pedido)).length;
  const dotSup = document.getElementById('sup-unread-dot');
  if (dotSup) { if (pendentes > 0) { dotSup.classList.remove('hidden'); dotSup.textContent = pendentes; } else dotSup.classList.add('hidden'); }
  const el = document.getElementById('lista-pedidos-suprimentos');
  if (lista.length === 0) { el.innerHTML = `<p class="p-6 text-xs text-slate-400 text-center">Nenhuma solicitação registrada neste posto.</p>`; return; }

  const badges = {
    SOLICITADO: `<span class="text-[10px] font-extrabold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full">⏳ Solicitado</span>`,
    EM_COMPRA: `<span class="text-[10px] font-extrabold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">🚚 Em Separação</span>`,
    ENTREGUE: `<span class="text-[10px] font-extrabold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">✅ Entregue</span>`,
    NEGADO: `<span class="text-[10px] font-extrabold bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-200">❌ Negado</span>`
  };

  el.innerHTML = lista.map(p => {
    const isNegado = p.status_pedido === 'NEGADO';
    const numTag = p.numero_pedido ? `<span class="text-[10px] font-extrabold text-slate-500">#${String(p.numero_pedido).padStart(3, '0')}</span>` : '';
    return `<div class="p-3.5 text-xs ${isNegado ? 'bg-red-50/40' : ''}"><div class="flex justify-between items-start gap-2"><div><div class="flex items-center gap-1.5 flex-wrap">${numTag}${p.urgente && !isNegado && p.status_pedido !== 'ENTREGUE' ? `<span class="text-[9px] font-extrabold bg-red-600 text-white px-1.5 py-0.5 rounded">URGENTE</span>` : ''}<span class="font-extrabold ${isNegado ? 'text-slate-600 line-through' : 'text-slate-900'}">${p.item || 'Pedido múltiplo'}</span><span class="text-[11px] font-bold text-orange-600">(${p.quantidade_calculada || '-'})</span></div><p class="text-[10px] text-slate-500 mt-0.5">Local: ${p.area_destino || 'Posto'} • ${new Date(p.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} por ${p.solicitante}</p>${p.observacao ? `<p class="text-[10px] text-slate-600 italic mt-0.5">"${p.observacao}"</p>` : ''}</div><div class="flex-shrink-0">${badges[p.status_pedido] || p.status_pedido}</div></div>${isNegado ? `<div class="mt-2 bg-red-100/70 border border-red-200 rounded-xl px-2.5 py-1.5 text-[11px] text-red-900 font-semibold">↳ <b>Motivo:</b> ${p.motivo_negacao || 'Solicitação não aprovada.'}</div>` : ''}</div>`;
  }).join('');
}

async function carregarMensagensChat() {
  if (!navigator.onLine) return;
  const { data } = await sb.from('mensagens_chat').select('*').eq('cliente', clienteAtivo).eq('canal', canalChatAtivo).order('criado_em', { ascending: true }).limit(60);
  const box = document.getElementById('chat-messages-box');
  if (!data || data.length === 0) { box.innerHTML = `<p class="text-center text-xs text-slate-400 py-10">Nenhuma mensagem neste canal.</p>`; return; }
  const meuNome = window.usuarioLogado?.nome || 'Operador';
  box.innerHTML = data.map(m => {
    const souEu = normalizarTexto(m.autor_nome) === normalizarTexto(meuNome);
    return `<div class="flex flex-col ${souEu ? 'items-end' : 'items-start'}"><div class="max-w-[82%] rounded-2xl px-3.5 py-2.5 ${souEu ? 'bg-slate-900 text-white' : (m.urgente ? 'bg-red-50 border border-red-200 text-slate-900' : 'bg-white border border-slate-200 text-slate-800')} shadow-sm"><div class="flex items-center gap-1.5 mb-0.5">${m.urgente ? `<span class="bg-red-600 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase mr-1">Urgente</span>` : ''}<span class="text-[10px] font-extrabold ${souEu ? 'text-orange-400' : 'text-orange-600'}">${m.autor_nome}</span><span class="text-[9px] opacity-60">• ${new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div><p class="text-xs leading-relaxed">${m.mensagem}</p></div></div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
function selecionarCanalChat(canal) {
  canalChatAtivo = canal; mensagensNaoLidas[canal] = 0; atualizarBadgesNaoLidas();
  ['EQUIPE', 'SUPERVISAO', 'CLIENTE'].forEach(c => { document.getElementById(`btn-canal-${c}`).className = (c === canal) ? "py-2 px-2 rounded-xl text-[11px] font-bold bg-white text-slate-900 shadow-sm transition-all flex items-center justify-center" : "py-2 px-2 rounded-xl text-[11px] font-bold text-slate-600 hover:text-slate-900 transition-all flex items-center justify-center"; });
  atualizarBadgesNaoLidas(); carregarMensagensChat();
}
async function enviarMensagemChat() {
  if (!navigator.onLine) { alert("📵 Sem sinal para enviar mensagem."); return; }
  const input = document.getElementById('chat-input-text'), texto = input.value.trim(); if (!texto) return;
  const urgente = document.getElementById('chat-urgente').checked; input.value = ''; document.getElementById('chat-urgente').checked = false;
  await sb.from('mensagens_chat').insert([{ cliente: clienteAtivo, canal: canalChatAtivo, autor_nome: window.usuarioLogado?.nome || 'Operador', autor_perfil: window.usuarioLogado?.perfil || 'OPERADOR', mensagem: texto, urgente }]);
  carregarMensagensChat();
}

function iniciarRealtimeSupabase() {
  if (canalRealtimeIniciado) return;
  canalRealtimeIniciado = true;
  sb.channel('novaera-operador-v10')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presenca_posto' }, () => carregarDadosSupabase())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'execucoes_auditoria' }, () => carregarDadosSupabase())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_suprimentos' }, () => carregarDadosSupabase())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'catalogo_suprimentos' }, () => carregarDadosSupabase())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensagens_chat' }, payload => {
      const msg = payload.new; if (msg.cliente !== clienteAtivo) return;
      if (normalizarTexto(msg.autor_nome) !== normalizarTexto(window.usuarioLogado?.nome || '')) {
        tocarChimeNotificacao();
        if (!(tabAtual === 'chat' && canalChatAtivo === msg.canal)) {
          mensagensNaoLidas[msg.canal] = (mensagensNaoLidas[msg.canal] || 0) + 1;
          atualizarBadgesNaoLidas(); dispararNotificacaoVisual(msg.autor_nome, msg.canal, msg.mensagem, msg.urgente);
        }
      }
      carregarMensagensChat();
    }).subscribe();
}
