// =========================================================================
// MÓDULO OFFLINE HÍBRIDO (CACHE-FIRST + CHECK-IN LOCAL + INDEXEDDB + PWA)
// =========================================================================
(function () {
  const DB_NAME = 'novaera_offline_db';
  const DB_VERSION = 1;
  const STORE_QUEUE = 'fila_sync';
  const SNAPSHOT_PREFIX = 'novaera_snapshot_v2_';
  const CHECKIN_PREFIX = 'novaera_checkin_v2_';

  function registrarPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function withTimeout(promise, ms = 5000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_REDE')), ms))
    ]);
  }

  // --- CHECK-IN PERSISTIDO NO APARELHO (NÃO PERDE SE O iOS RECARREGAR A ABA) ---
  function saveCheckinLocal(cliente, dataISO, presencaObj) {
    if (!cliente || !dataISO) return;
    const key = `${CHECKIN_PREFIX}${cliente}_${dataISO}`;
    try {
      if (presencaObj) localStorage.setItem(key, JSON.stringify(presencaObj));
      else localStorage.removeItem(key);
    } catch (e) {}
  }

  function loadCheckinLocal(cliente, dataISO) {
    if (!cliente || !dataISO) return null;
    try {
      const raw = localStorage.getItem(`${CHECKIN_PREFIX}${cliente}_${dataISO}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // --- SNAPSHOT DO CRONOGRAMA / CATÁLOGOS PARA RENDERIZAÇÃO IMEDIATA ---
  function saveSnapshot(cliente, payload) {
    if (!cliente || !payload) return;
    try {
      localStorage.setItem(`${SNAPSHOT_PREFIX}${cliente}`, JSON.stringify({
        saved_at: new Date().toISOString(),
        data: payload
      }));
    } catch (e) {}
  }

  function loadSnapshot(cliente) {
    if (!cliente) return null;
    try {
      const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}${cliente}`);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // --- INDEXEDDB PARA FILA OFFLINE (SUPORTA FOTOS EM BASE64 SEM ESTOURAR 5MB) ---
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'qid', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function enqueue(actionObj) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      const store = tx.objectStore(STORE_QUEUE);
      const req = store.add({
        ...actionObj,
        created_at: new Date().toISOString()
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeQueueItem(qid) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      const req = tx.objectStore(STORE_QUEUE).delete(qid);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function countQueue() {
    try {
      const list = await getQueue();
      return list.length;
    } catch (e) {
      return 0;
    }
  }

  window.NovaEraOffline = {
    registrarPWA,
    withTimeout,
    saveCheckinLocal,
    loadCheckinLocal,
    saveSnapshot,
    loadSnapshot,
    enqueue,
    getQueue,
    removeQueueItem,
    countQueue
  };
})();
