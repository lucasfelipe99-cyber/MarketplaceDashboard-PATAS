const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { transformShopee } = require('./lib/shopee-transform');
const { transformTikTok, transformAmazon, transformMagalu } = require('./lib/marketplace-transforms');


function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadLocalEnv(path.join(__dirname, '.env'));

const port = process.env.PORT || 8787;
const projectDir = __dirname;
const legacyDataDir = path.join(projectDir, 'data');
const dataDir = resolveDataDirectory(projectDir);
const assetsDir = path.join(projectDir, 'assets');
const metadataPath = path.join(dataDir, 'metadata.json');
const legacyMetadataPath = path.join(legacyDataDir, 'metadata.json');
const productMasterPath = path.join(dataDir, 'product-master.json');
const inventoryPath = path.join(dataDir, 'inventory.json');
const inventoryFullPath = path.join(dataDir, 'inventory-full.json');
const salesTreatersPath = path.join(dataDir, 'sales-treaters.json');
const pricingRulesPath = path.join(dataDir, 'pricing-rules.json');
const pricingDatabasePath = path.join(dataDir, 'pricing-database.json');
const budgetsPath = path.join(dataDir, 'budgets.json');
const accountsPath = path.join(dataDir, 'accounts.json');
const financialMappingPath = path.join(dataDir, 'de_para_categoria_classificacao.csv');

const intelligentAnalysisCachePath = path.join(dataDir, 'ai-intelligent-cache.json');
const intelligentAnalysisFallbackCachePath = path.join(os.tmpdir(), 'marketplace-ai-intelligent-cache.json');
const allowedBaseExtensions = new Set(['.xlsx', '.xls', '.csv']);
const allowedAssetExtensions = new Set(['.html', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.css', '.js', '.json']);
const monthKeys = new Set(Array.from({ length: 12 }, (_, index) => String(index + 1)));
const baseFinancialOptions = [
  ['Cashback', 'Receitas', 1], ['Juros Passivos', 'Receitas', 1], ['Outras receitas', 'Receitas', 1],
  ['Recebimentos', 'Receitas', 1], ['Rendimentos Bancários', 'Receitas', 1], ['Resgates', 'Receitas', 1],
  ['Vendas', 'Receitas', 1], ['Rendimentos', 'Juros Sobre Investimento', 2],
  ['Fornecedor de Mercadoria', 'Produtos', 3], ['Insumos de Fabricação', 'Produtos', 3],
  ['Embalagens', 'Embalagem', 4], ['DAS', 'Imposto sobre Mercadoria Vendida', 5],
  ['Salários', 'Despesas com pessoal', 6], ['Refeições', 'Despesas com pessoal', 6],
  ['Pró-Labore', 'Pró-labore', 7], ['Limpeza', 'Manutenção Operacional', 8],
  ['Aluguéis e condomínio', 'Aluguel', 9], ['Contabilidade', 'Serviços', 10],
  ['ADS Mercado Livre', 'Despesas com ADS', 11], ['Frete - FULL', 'Despesas com FULL', 12],
  ['Frete', 'Despesas Comerciais', 13], ['Manutenção Predial', 'Manutenção', 14],
  ['Tiny', 'Gastos com Sistema', 15], ['Combustível', 'Gastos com veículos', 16],
  ['Tarifas Bancárias', 'Despesas Financeiras', 17], ['Empréstimo Bancário', 'Amortização (Empréstimos)', 18],
  ['Investimentos', 'Investimentos', 19], ['Parcelamento de DAS', 'Parcelamentos', 21],
  ['Transferência', 'Transferência', 99]
].map((item, index) => ({ id: 'base-financial-' + index, category: item[0], classification: item[1], order: item[2] }));

const copilotLastRunByIp = new Map();
let intelligentAnalysisPromise = null;
let intelligentAnalysisMemoryCache = null;
const maxAiRequestBytes = 80 * 1024;
const maxCopilotRequestBytes = 8 * 1024 * 1024;
const maxUploadBytes = getPositiveIntegerEnv('MAX_UPLOAD_MB', 4096) * 1024 * 1024;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

fs.mkdirSync(dataDir, { recursive: true });

function resolveDataDirectory(baseDir) {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }

  if (process.platform !== 'win32' && fs.existsSync('/var/data')) {
    return '/var/data';
  }

  if (process.platform === 'win32' && /\\Drives compartilhados\\/i.test(baseDir)) {
    return path.join(
      os.tmpdir(),
      'MarketplaceDashboard',
      'data'
    );
  }

  return path.join(baseDir, 'data');
}

function resolveDataFilePath(fileName) {
  if (!fileName || fileName !== path.basename(fileName)) {
    return '';
  }

  const runtimePath = path.join(dataDir, fileName);
  if (fs.existsSync(runtimePath)) {
    return runtimePath;
  }

  const legacyPath = path.join(legacyDataDir, fileName);
  return fs.existsSync(legacyPath) ? legacyPath : runtimePath;
}

function getPositiveIntegerEnv(name, fallback) {
  const parsed = Number(process.env[name]);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sendFile(response, filePath, contentType, cacheControl) {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      const notFound = !error || error.code === 'ENOENT';
      response.writeHead(notFound ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      response.end(notFound ? 'Arquivo nao encontrado.' : 'Erro ao ler arquivo.');
      return;
    }

    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': cacheControl || 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(text);
}

function resolvePublicFile(urlPath) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  } catch (error) {
    return null;
  }

  if (decodedPath === '/' || decodedPath === '/index.html') {
    return path.join(projectDir, 'index.html');
  }

  if (decodedPath.startsWith('/assets/')) {
    const relativePath = decodedPath.slice('/assets/'.length);
    const resolvedPath = path.resolve(assetsDir, relativePath);
    const relativeResolvedPath = path.relative(assetsDir, resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();

    if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath) || !allowedAssetExtensions.has(extension)) {
      return null;
    }

    return resolvedPath;
  }

  if (decodedPath.startsWith('/data/')) {
    const requestedName = decodedPath.slice('/data/'.length);

    if (!requestedName || requestedName !== path.basename(requestedName) || !getPublishedDataFileNames().has(requestedName)) {
      return null;
    }

    return resolveDataFilePath(requestedName);
  }

  return null;
}

function getPublishedDataFileNames() {
  const names = new Set();
  const metadata = readMetadata();

  Object.values(metadata.areas || {}).forEach((area) => {
    Object.values(area && area.months || {}).forEach((month) => {
      if (month && month.storedName) {
        names.add(month.storedName);
      }
      if (month && month.rowsName) {
        names.add(month.rowsName);
      }
    });
  });

  return names;
}

function safePasswordEquals(providedPassword, configuredPassword) {
  const provided = Buffer.from(String(providedPassword || ''), 'utf8');
  const configured = Buffer.from(String(configuredPassword || ''), 'utf8');

  return provided.length === configured.length && crypto.timingSafeEqual(provided, configured);
}

function normalizeMonth(value) {
  const month = String(value || '').trim();

  return monthKeys.has(month) ? month : '';
}

function getMonthFromUrl(url) {
  try {
    const parsedUrl = new URL(url, 'http://localhost');

    return normalizeMonth(parsedUrl.searchParams.get('month'));
  } catch (error) {
    return '';
  }
}

function readMetadata() {
  const sourcePath = fs.existsSync(metadataPath)
    ? metadataPath
    : legacyMetadataPath;

  if (!fs.existsSync(sourcePath)) {
    return { areas: { area1: { months: {} } } };
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

    if (metadata.areas) {
      metadata.areas.area1 = metadata.areas.area1 || { months: {} };
      return metadata;
    }

    if (metadata.months) {
      return { areas: { area1: metadata } };
    }

    if (metadata.storedName) {
      const legacyMonth = metadata.updatedAt
        ? String(new Date(metadata.updatedAt).getMonth() + 1)
        : String(new Date().getMonth() + 1);

      return { areas: { area1: { months: { [legacyMonth]: metadata } } } };
    }

    return { areas: { area1: { months: {} } } };
  } catch (error) {
    return { areas: { area1: { months: {} } } };
  }
}

function getPublishedMetadata(month) {
  const metadata = readMetadata();
  const areaMetadata = metadata.areas.area1 || { months: {} };
  const monthMetadata = areaMetadata.months[month] || {};
  const forecastMetadata = metadata.forecast && String(metadata.forecast.targetMonth) === String(month)
    ? metadata.forecast
    : null;
  const rowsUpdatedAt = [monthMetadata.rowsUpdatedAt, forecastMetadata && forecastMetadata.generatedAt]
    .filter(Boolean)
    .sort()
    .pop() || null;
  const filePath = resolveDataFilePath(monthMetadata.storedName || '');

  if (!monthMetadata.storedName || !fs.existsSync(filePath)) {
    return { exists: false, month };
  }

  return {
    exists: true,
    month,
    fileName: monthMetadata.fileName,
    storedName: monthMetadata.storedName,
    rowsName: monthMetadata.rowsName,
    updatedAt: monthMetadata.updatedAt,
    rowsUpdatedAt,
    size: monthMetadata.size,
    url: '/data/' + encodeURIComponent(monthMetadata.storedName),
    rowsUrl: monthMetadata.rowsName && fs.existsSync(resolveDataFilePath(monthMetadata.rowsName))
      ? '/data/' + encodeURIComponent(monthMetadata.rowsName)
      : ''
  };
}

function getAllPublishedMetadata() {
  const months = {};

  monthKeys.forEach((month) => {
    const monthMetadata = getPublishedMetadata(month);

    if (monthMetadata.exists) {
      months[month] = monthMetadata;
    }
  });

  return {
    exists: Object.keys(months).length > 0,
    months
  };
}

function deletePreviousBases(area, month, keepNames) {
  const keep = new Set((keepNames || []).filter(Boolean));

  fs.readdirSync(dataDir).forEach((name) => {
    const pattern = new RegExp('^' + area + '-current-(base|rows)-' + month + '(?:-[0-9]+)?\\.(xlsx|xls|csv|json)$', 'i');

    if (!pattern.test(name) || keep.has(name)) {
      return;
    }

    try {
      fs.unlinkSync(path.join(dataDir, name));
    } catch (error) {
      console.warn('Nao foi possivel apagar base antiga, seguindo com novo arquivo:', name, error.message);
    }
  });
}

function createStoredName(area, type, month, extension) {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);

  return area + '-current-' + type + '-' + month + '-' + timestamp + '-' + suffix + extension;
}

function writeFileWithRetry(filePath, content, attempts = 6) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content, { flag: 'wx' });
      return;
    } catch (error) {
      lastError = error;

      if (!['EPERM', 'EACCES', 'EBUSY', 'EEXIST'].includes(error.code) || attempt === attempts) {
        break;
      }

      const waitUntil = Date.now() + attempt * 120;
      while (Date.now() < waitUntil) {}
    }
  }

  throw lastError;
}

function createUploadStagingPath(extension) {
  return path.join(
    os.tmpdir(),
    'marketplace-upload-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + extension
  );
}

function waitSynchronously(milliseconds) {
  const waitBuffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(waitBuffer), 0, 0, milliseconds);
}

function persistStagedFile(stagingPath, destinationPath, attempts = 10) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.copyFileSync(stagingPath, destinationPath, fs.constants.COPYFILE_EXCL);
      return;
    } catch (error) {
      lastError = error;
      if (error.code === 'EEXIST') {
        throw error;
      }
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOENT'].includes(error.code) || attempt === attempts) {
        break;
      }
      waitSynchronously(Math.min(250 * attempt, 1500));
    }
  }

  throw lastError;
}

function writeJsonWithRetry(filePath, value, attempts = 10) {
  const content = JSON.stringify(value, null, 2);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.writeFileSync(filePath, content);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === attempts) {
        break;
      }
      waitSynchronously(Math.min(200 * attempt, 1200));
    }
  }

  throw lastError;
}

function readBudgets() {
  if (!fs.existsSync(budgetsPath)) {
    return { version: 1, years: {}, updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
    return {
      version: 1,
      years: value.years && typeof value.years === 'object' ? value.years : {},
      updatedAt: value.updatedAt || null
    };
  } catch (error) {
    return { version: 1, years: {}, updatedAt: null };
  }
}

function readFinancialMappingFileOptions() {
  if (!fs.existsSync(financialMappingPath)) return [];
  return fs.readFileSync(financialMappingPath, 'utf8').split(/\r?\n/).slice(1).map((line) => {
    const columns = line.split(',');
    return {
      category: String(columns[0] || '').trim(),
      classification: String(columns[1] || '').trim(),
      order: Number(columns[2]) || 999
    };
  }).filter((item) => item.category && item.classification);
}

function readFinancialOptions() {
  const state = readAccounts();
  const saved = Array.isArray(state.financialOptions) ? state.financialOptions : [];
  const fileOptions = readFinancialMappingFileOptions();
  const source = saved.length ? saved : fileOptions.length ? fileOptions : baseFinancialOptions;
  return source.map((item, index) => ({
    id: String(item.id || 'financial-option-' + index),
    category: String(item.category || '').trim(),
    classification: String(item.classification || '').trim(),
    order: Number(item.order) || index + 1
  })).filter((item) => item.category && item.classification && item.category.toLocaleLowerCase('pt-BR') !== 'projetos patas fieis' && item.category.toLocaleLowerCase('pt-BR') !== 'projetos patas fiéis');
}

function mergeAutomaticFinancialCompanies(savedCompanies) {
  const companies = Array.isArray(savedCompanies) ? savedCompanies.slice() : [];
  const registeredAccounts = getRegisteredMarketplaceAccounts();
  const byName = new Map(companies.map((item) => [String(item.name || '').trim().toLocaleLowerCase('pt-BR'), item]));
  registeredAccounts.forEach((account) => {
    const name = String(account.account || '').trim();
    const key = name.toLocaleLowerCase('pt-BR');
    if (!name || byName.has(key)) return;
    const item = {
      id: 'sales-' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 20),
      name,
      document: '',
      source: 'sales',
      marketplaces: [String(account.marketplace || '').trim()].filter(Boolean),
      updatedAt: new Date().toISOString()
    };
    companies.push(item);
    byName.set(key, item);
  });
  companies.forEach((company) => {
    const linked = registeredAccounts.filter((account) => String(account.account || '').trim().toLocaleLowerCase('pt-BR') === String(company.name || '').trim().toLocaleLowerCase('pt-BR'));
    if (linked.length) {
      company.source = 'sales';
      company.marketplaces = Array.from(new Set(linked.map((item) => String(item.marketplace || '').trim()).filter(Boolean)));
    }
  });
  return companies.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
}

function readAccounts() {
  if (!fs.existsSync(accountsPath)) {
    return { version: 3, companies: mergeAutomaticFinancialCompanies([]), counterparties: [], payables: [], receivables: [], bankAccounts: [], paymentMethods: [], financialOptions: [], updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    return {
      version: 3,
      companies: mergeAutomaticFinancialCompanies(value.companies),
      counterparties: Array.isArray(value.counterparties) ? value.counterparties : [],
      payables: Array.isArray(value.payables) ? value.payables : [],
      receivables: Array.isArray(value.receivables) ? value.receivables : [],
      bankAccounts: Array.isArray(value.bankAccounts) ? value.bankAccounts : [],
      paymentMethods: Array.isArray(value.paymentMethods) ? value.paymentMethods : [],
      financialOptions: Array.isArray(value.financialOptions) ? value.financialOptions : [],
      updatedAt: value.updatedAt || null
    };
  } catch (error) {
    return { version: 3, companies: mergeAutomaticFinancialCompanies([]), counterparties: [], payables: [], receivables: [], bankAccounts: [], paymentMethods: [], financialOptions: [], updatedAt: null };
  }
}

function addMonthsToAccountDate(isoDate, months) {
  const parts = String(isoDate || '').split('-').map(Number);
  const target = new Date(Date.UTC(parts[0], parts[1] - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(parts[2], lastDay);
  return [target.getUTCFullYear(), String(target.getUTCMonth() + 1).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function cleanAccountRecord(payload, type, current) {
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');
  const dueDate = String(payload.dueDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Informe uma data de vencimento valida.');
  const description = String(payload.description || '').trim();
  if (!description) throw new Error('Informe a descricao.');
  const companyId = String(payload.companyId || current && current.companyId || '').trim();
  return {
    id: current && current.id || crypto.randomUUID(),
    type,
    companyId,
    description,
    counterpartyId: String(payload.counterpartyId || '').trim(),
    dueDate,
    competenceDate: String(payload.competenceDate || dueDate).trim(),
    amount: Math.round(amount * 100) / 100,
    classification: String(payload.classification || '').trim(),
    category: String(payload.category || '').trim(),
    account: String(payload.account || '').trim(),
    bankAccountId: String(payload.bankAccountId || '').trim(),
    paymentMethodId: String(payload.paymentMethodId || '').trim(),
    installmentGroupId: String(payload.installmentGroupId || current && current.installmentGroupId || '').trim(),
    installmentNumber: Math.max(1, Number(payload.installmentNumber) || current && current.installmentNumber || 1),
    installmentCount: Math.max(1, Number(payload.installmentCount) || current && current.installmentCount || 1),
    document: String(payload.document || '').trim(),
    notes: String(payload.notes || '').trim(),
    status: current && current.status || 'open',
    settledAt: current && current.settledAt || '',
    createdAt: current && current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function handleAccountsUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 8 * 1024 * 1024);
    const state = readAccounts();
    if (payload.action === 'upsert-company') {
      const name = String(payload.name || '').trim();
      if (!name) return sendJson(response, 400, { error: 'Informe o nome da empresa.' });
      const id = String(payload.id || '').trim();
      const duplicate = state.companies.find((item) => item.id !== id && String(item.name || '').trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'));
      if (duplicate) return sendJson(response, 400, { error: 'Esta empresa já está cadastrada.' });
      const current = state.companies.find((item) => item.id === id);
      const item = { id: current && current.id || crypto.randomUUID(), name, document: String(payload.document || '').trim(), updatedAt: new Date().toISOString() };
      if (current) Object.assign(current, item); else state.companies.push(item);
    } else if (payload.action === 'upsert-counterparty') {
      const name = String(payload.name || '').trim();
      const kind = ['client', 'supplier', 'both'].includes(payload.kind) ? payload.kind : 'both';
      if (!name) return sendJson(response, 400, { error: 'Informe o nome.' });
      const id = String(payload.id || '').trim();
      const current = state.counterparties.find((item) => item.id === id);
      const item = {
        id: current && current.id || crypto.randomUUID(),
        name,
        kind,
        document: String(payload.document || '').trim(),
        email: String(payload.email || '').trim(),
        phone: String(payload.phone || '').trim(),
        updatedAt: new Date().toISOString()
      };
      if (current) Object.assign(current, item); else state.counterparties.push(item);
    } else if (payload.action === 'upsert-financial-config') {
      const configType = payload.configType === 'paymentMethod' ? 'paymentMethod' : 'bankAccount';
      const collection = configType === 'paymentMethod' ? state.paymentMethods : state.bankAccounts;
      const name = String(payload.name || '').trim();
      if (!name) return sendJson(response, 400, { error: 'Informe o nome do cadastro.' });
      const normalized = name.toLocaleLowerCase('pt-BR');
      const duplicate = collection.find((item) => String(item.name || '').trim().toLocaleLowerCase('pt-BR') === normalized && item.id !== String(payload.id || ''));
      if (duplicate) return sendJson(response, 400, { error: 'Este cadastro ja existe.' });
      const current = collection.find((item) => item.id === String(payload.id || ''));
      const item = { id: current && current.id || crypto.randomUUID(), name, updatedAt: new Date().toISOString() };
      if (current) Object.assign(current, item); else collection.push(item);
    } else if (payload.action === 'upsert-financial-option') {
      if (!state.financialOptions.length) {
        const seed = readFinancialMappingFileOptions();
        state.financialOptions = (seed.length ? seed : baseFinancialOptions).filter((item) => !/^projetos patas fi[eé]is$/i.test(String(item.category || ''))).map((item, index) => ({ ...item, id: crypto.randomUUID(), order: Number(item.order) || index + 1 }));
      }
      const classification = String(payload.classification || '').trim();
      const category = String(payload.category || '').trim();
      if (!classification || !category) return sendJson(response, 400, { error: 'Informe a classificacao e a categoria.' });
      const id = String(payload.id || '').trim();
      const current = state.financialOptions.find((item) => item.id === id);
      const duplicate = state.financialOptions.find((item) => item.id !== id && String(item.classification).toLocaleLowerCase('pt-BR') === classification.toLocaleLowerCase('pt-BR') && String(item.category).toLocaleLowerCase('pt-BR') === category.toLocaleLowerCase('pt-BR'));
      if (duplicate) return sendJson(response, 400, { error: 'Esta categoria ja existe nesta classificacao.' });
      const previousClassification = current ? current.classification : '';
      const previousCategory = current ? current.category : '';
      const requestedOrder = Number(payload.order);
      const item = { id: current && current.id || crypto.randomUUID(), classification, category, order: current && current.order || (Number.isFinite(requestedOrder) && requestedOrder > 0 ? requestedOrder : state.financialOptions.length + 1) };
      if (current) Object.assign(current, item); else state.financialOptions.push(item);
      if (current) {
        state.payables.concat(state.receivables).forEach((record) => {
          if (record.classification === previousClassification && record.category === previousCategory) {
            record.classification = classification;
            record.category = category;
            record.updatedAt = new Date().toISOString();
          }
        });
      }
    } else if (payload.action === 'rename-financial-classification') {
      if (!state.financialOptions.length) {
        const seed = readFinancialMappingFileOptions();
        state.financialOptions = (seed.length ? seed : baseFinancialOptions).filter((item) => !/^projetos patas fi[eé]is$/i.test(String(item.category || ''))).map((item, index) => ({ ...item, id: crypto.randomUUID(), order: Number(item.order) || index + 1 }));
      }
      const previousName = String(payload.previousName || '').trim();
      const name = String(payload.name || '').trim();
      if (!previousName || !name) return sendJson(response, 400, { error: 'Informe a classificacao.' });
      let changed = 0;
      state.financialOptions.forEach((item) => { if (item.classification === previousName) { item.classification = name; changed += 1; } });
      if (!changed) return sendJson(response, 404, { error: 'Classificacao nao encontrada.' });
      state.payables.concat(state.receivables).forEach((record) => {
        if (record.classification === previousName) { record.classification = name; record.updatedAt = new Date().toISOString(); }
      });
    } else if (payload.action === 'upsert-account') {
      const type = payload.type === 'receivable' ? 'receivable' : 'payable';
      const collection = type === 'payable' ? state.payables : state.receivables;
      const current = collection.find((item) => item.id === String(payload.id || ''));
      if (state.companies.length && !state.companies.some((item) => item.id === String(payload.companyId || current && current.companyId || ''))) {
        return sendJson(response, 400, { error: 'Selecione a empresa correta para o lançamento.' });
      }
      const installmentCount = type === 'payable' && !current ? Math.min(120, Math.max(1, Number(payload.installmentCount) || 1)) : 1;
      if (installmentCount > 1) {
        const totalCents = Math.round(Number(payload.amount) * 100);
        if (!Number.isFinite(totalCents) || totalCents <= 0) throw new Error('Informe um valor maior que zero.');
        const baseCents = Math.floor(totalCents / installmentCount);
        const groupId = crypto.randomUUID();
        for (let index = 0; index < installmentCount; index += 1) {
          const installmentPayload = {
            ...payload,
            amount: (baseCents + (index === installmentCount - 1 ? totalCents - baseCents * installmentCount : 0)) / 100,
            dueDate: addMonthsToAccountDate(payload.dueDate, index),
            description: String(payload.description || '').trim() + ' (' + (index + 1) + '/' + installmentCount + ')',
            installmentGroupId: groupId,
            installmentNumber: index + 1,
            installmentCount
          };
          collection.push(cleanAccountRecord(installmentPayload, type, null));
        }
      } else {
        const item = cleanAccountRecord(payload, type, current);
        if (current) Object.assign(current, item); else collection.push(item);
      }
    } else if (payload.action === 'import-accounts') {
      const type = payload.type === 'receivable' ? 'receivable' : 'payable';
      const collection = type === 'payable' ? state.payables : state.receivables;
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length || rows.length > 20000) return sendJson(response, 400, { error: 'Nenhum titulo valido para importar.' });
      if (state.companies.length && !state.companies.some((item) => item.id === String(payload.companyId || ''))) return sendJson(response, 400, { error: 'Selecione a empresa da importação.' });
      rows.forEach((row) => { row.companyId = String(payload.companyId || row.companyId || ''); });
      rows.forEach((row) => collection.push(cleanAccountRecord(row, type, null)));
    } else if (payload.action === 'settle-account') {
      const type = payload.type === 'receivable' ? 'receivable' : 'payable';
      const collection = type === 'payable' ? state.payables : state.receivables;
      const item = collection.find((record) => record.id === String(payload.id || ''));
      if (!item) return sendJson(response, 404, { error: 'Titulo nao encontrado.' });
      item.status = 'settled';
      item.settledAt = String(payload.settledAt || '').trim() || new Date().toISOString().slice(0, 10);
      item.updatedAt = new Date().toISOString();
    } else if (payload.action === 'delete-account') {
      const type = payload.type === 'receivable' ? 'receivable' : 'payable';
      const collectionName = type === 'payable' ? 'payables' : 'receivables';
      const collection = state[collectionName];
      const index = collection.findIndex((record) => record.id === String(payload.id || ''));
      if (index < 0) return sendJson(response, 404, { error: 'Titulo nao encontrado.' });
      collection.splice(index, 1);
    } else {
      return sendJson(response, 400, { error: 'Acao financeira invalida.' });
    }
    state.updatedAt = new Date().toISOString();
    writeJsonWithRetry(accountsPath, state);
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

async function handleBudgetsUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 4 * 1024 * 1024);
    if (payload.action !== 'save-year') {
      return sendJson(response, 400, { error: 'Acao de orcamento invalida.' });
    }
    const year = Number(payload.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return sendJson(response, 400, { error: 'Ano do orcamento invalido.' });
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length || rows.length > 500) {
      return sendJson(response, 400, { error: 'O orcamento deve possuir entre 1 e 500 linhas.' });
    }
    const cleanRows = rows.map((row, index) => {
      const label = String(row && row.label || '').trim();
      const kind = ['classification', 'category', 'standalone'].includes(row && row.kind)
        ? row.kind
        : 'category';
      if (!label) throw new Error(`Linha ${index + 1} sem descricao.`);
      const values = Array.from({ length: 12 }, (_, monthIndex) => {
        const number = Number(Array.isArray(row.values) ? row.values[monthIndex] : 0);
        if (!Number.isFinite(number)) throw new Error(`Valor invalido na linha ${index + 1}.`);
        return Math.round(number * 100) / 100;
      });
      return {
        id: String(row.id || '').trim() || crypto.randomUUID(),
        label,
        kind,
        parentId: kind === 'category' ? String(row.parentId || '').trim() : '',
        values
      };
    });
    const state = readBudgets();
    const updatedAt = new Date().toISOString();
    state.years[String(year)] = { year, rows: cleanRows, updatedAt };
    state.updatedAt = updatedAt;
    writeJsonWithRetry(budgetsPath, state);
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

function streamRequestToFile(request, filePath, maxBytes) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length']) || 0;
    let totalBytes = 0;
    let settled = false;
    const output = fs.createWriteStream(filePath, { flags: 'wx' });

    const cleanupPartialFile = () => {
      fs.rm(filePath, { force: true }, () => {});
    };
    const fail = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      request.unpipe(output);
      output.destroy();
      request.resume();
      cleanupPartialFile();
      reject(error);
    };

    if (declaredLength > maxBytes) {
      output.destroy();
      cleanupPartialFile();
      reject(new Error('UPLOAD_TOO_LARGE'));
      request.resume();
      return;
    }

    request.on('data', (chunk) => {
      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        fail(new Error('UPLOAD_TOO_LARGE'));
      }
    });
    request.on('aborted', () => fail(new Error('UPLOAD_ABORTED')));
    request.on('error', fail);
    output.on('error', fail);
    output.on('finish', () => {
      if (settled) {
        return;
      }

      settled = true;
      if (totalBytes === 0) {
        cleanupPartialFile();
        reject(new Error('EMPTY_UPLOAD'));
        return;
      }
      resolve(totalBytes);
    });

    request.pipe(output);
  });
}

function writeMonthMetadata(month, nextMetadata) {
  const metadata = readMetadata();

  metadata.areas.area1 = metadata.areas.area1 || { months: {} };
  metadata.areas.area1.months[month] = nextMetadata;
  writeJsonWithRetry(metadataPath, metadata);
}

function getLegacyPublishedMetadata() {
  const sourcePath = fs.existsSync(metadataPath) ? metadataPath : legacyMetadataPath;
  if (!fs.existsSync(sourcePath)) {
    return { exists: false };
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const filePath = resolveDataFilePath(metadata.storedName || '');

    if (!metadata.storedName || !fs.existsSync(filePath)) {
      return { exists: false };
    }

    return {
      exists: true,
      fileName: metadata.fileName,
      storedName: metadata.storedName,
      updatedAt: metadata.updatedAt,
      size: metadata.size,
      url: '/data/' + encodeURIComponent(metadata.storedName)
    };
  } catch (error) {
    return { exists: false };
  }
}

async function handleBaseUpload(request, response) {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const providedPassword = request.headers['x-admin-password'] || '';
  const month = normalizeMonth(request.headers['x-base-month']);
  const area = 'area1';

  if (!configuredPassword) {
    sendText(response, 500, 'ADMIN_PASSWORD nao configurada no servidor.');
    return;
  }

  if (!safePasswordEquals(providedPassword, configuredPassword)) {
    sendText(response, 401, 'Senha invalida.');
    return;
  }

  if (!month) {
    sendText(response, 400, 'Mes invalido para publicacao.');
    return;
  }

  const originalName = decodeURIComponent(request.headers['x-file-name'] || '');
  const extension = path.extname(originalName).toLowerCase();

  if (!allowedBaseExtensions.has(extension)) {
    sendText(response, 400, 'Formato nao aceito. Envie .xlsx, .xls ou .csv.');
    return;
  }

  const storedName = createStoredName(area, 'base', month, extension);
  const storedPath = path.join(dataDir, storedName);
  const stagingPath = createUploadStagingPath(extension);

  try {
    const size = await streamRequestToFile(request, stagingPath, maxUploadBytes);
    persistStagedFile(stagingPath, storedPath);
    const metadata = {
      fileName: path.basename(originalName),
      storedName,
      updatedAt: new Date().toISOString(),
      size
    };

    writeMonthMetadata(month, metadata);
    deletePreviousBases(area, month, [storedName]);
    sendJson(response, 200, getPublishedMetadata(month));
  } catch (writeError) {
    console.error('Erro ao publicar base:', writeError);
    if (writeError.message === 'UPLOAD_TOO_LARGE') {
      sendText(response, 413, 'Arquivo acima do limite configurado de ' + Math.round(maxUploadBytes / 1024 / 1024) + ' MB.');
      return;
    }
    sendText(response, 500, 'Erro ao salvar a base no servidor: ' + writeError.message);
  } finally {
    fs.rm(stagingPath, { force: true }, () => {});
  }
}

async function handleRowsUpload(request, response) {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const providedPassword = request.headers['x-admin-password'] || '';
  const month = normalizeMonth(request.headers['x-base-month']);
  const area = 'area1';

  if (!configuredPassword) {
    sendText(response, 500, 'ADMIN_PASSWORD nao configurada no servidor.');
    return;
  }

  if (!safePasswordEquals(providedPassword, configuredPassword)) {
    sendText(response, 401, 'Senha invalida.');
    return;
  }

  if (!month) {
    sendText(response, 400, 'Mes invalido para publicacao.');
    return;
  }

  const metadata = readMetadata();
  const areaMetadata = metadata.areas.area1 || { months: {} };
  const monthMetadata = areaMetadata.months[month];

  if (!monthMetadata || !monthMetadata.storedName) {
    sendText(response, 400, 'Publique a base do mes antes de salvar os dados processados.');
    request.resume();
    return;
  }

  const rowsName = createStoredName(area, 'rows', month, '.json');
  const rowsPath = path.join(dataDir, rowsName);
  const stagingPath = createUploadStagingPath('.json');

  try {
    await streamRequestToFile(request, stagingPath, maxUploadBytes);
    applyProductCategoriesToRowsFile(stagingPath);
    persistStagedFile(stagingPath, rowsPath);
    monthMetadata.rowsName = rowsName;
    monthMetadata.rowsUpdatedAt = new Date().toISOString();
    metadata.areas.area1 = metadata.areas.area1 || { months: {} };
    metadata.areas.area1.months[month] = monthMetadata;
    writeJsonWithRetry(metadataPath, metadata);
    deletePreviousBases(area, month, [monthMetadata.storedName, rowsName]);
    sendJson(response, 200, getPublishedMetadata(month));
    setImmediate(() => {
      ensureIntelligentAnalysis(true).catch((error) => {
        console.error('Nao foi possivel atualizar a Analise Inteligente apos a publicacao:', error.message);
      });
    });
  } catch (writeError) {
    console.error('Erro ao salvar dados processados:', writeError);
    if (writeError.message === 'UPLOAD_TOO_LARGE') {
      sendText(response, 413, 'Dados processados acima do limite configurado de ' + Math.round(maxUploadBytes / 1024 / 1024) + ' MB.');
      return;
    }
    sendText(response, 500, 'Erro ao congelar os dados do mes: ' + writeError.message);
  } finally {
    fs.rm(stagingPath, { force: true }, () => {});
  }
}

function isForecastRow(row, header) {
  if (!Array.isArray(row)) return false;
  const index = header.findIndex((value) => String(value || '').trim().toLowerCase() === 'datatype');
  return index >= 0 && String(row[index] || '').trim().toLowerCase() === 'forecast';
}

function getForecastStatus() {
  const metadata = readMetadata();
  return metadata.forecast || { generated: false };
}

async function handleForecastPublish(request, response) {
  if (!requireAdmin(request, response)) return;
  try {
    const payload = await collectJsonRequest(request, maxUploadBytes);
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const force = payload.force === true;
    const requestedTargetMonth = normalizeMonth(payload.targetMonth);
    const requestedTargetYear = Number(payload.targetYear);
    if (!requestedTargetMonth || !Number.isInteger(requestedTargetYear) || requestedTargetYear < 2020 || requestedTargetYear > 2100) {
      sendJson(response, 400, { error: 'Selecione um mês e ano válidos para publicar o Forecast.' });
      return;
    }
    const metadata = readMetadata();
    if (metadata.forecast && metadata.forecast.generated && !force) {
      sendJson(response, 409, { error: 'O forecast já foi gerado. Use Gerar novamente para substituir a versão atual.', forecast: metadata.forecast });
      return;
    }
    if (rows.length < 2 || !Array.isArray(rows[0])) {
      sendJson(response, 400, { error: 'Forecast vazio ou em formato inválido.' });
      return;
    }
    const header = rows[0].map((value) => String(value || '').trim());
    const required = ['Marketplace', 'Marketplace venda', 'SKU', 'Data', 'Categoria', 'Sub Categoria', 'Valor', 'Datatype'];
    const missing = required.filter((name) => !header.includes(name));
    if (missing.length) {
      sendJson(response, 400, { error: 'Colunas ausentes no forecast: ' + missing.join(', ') });
      return;
    }
    const forecastRows = rows.slice(1).filter((row) => isForecastRow(row, header));
    if (!forecastRows.length) {
      sendJson(response, 400, { error: 'Nenhuma linha diária com Datatype Forecast foi recebida.' });
      return;
    }
    const dateIndex = header.indexOf('Data');
    const invalidTargetRows = forecastRows.filter((row) => {
      const parts = parseAnalysisDateParts(row[dateIndex], Number(requestedTargetMonth), requestedTargetYear);
      return !parts || Number(parts.month) !== Number(requestedTargetMonth) || Number(parts.year) !== requestedTargetYear;
    });
    if (invalidTargetRows.length) {
      sendJson(response, 400, { error: 'Existem linhas fora do mês selecionado. Recalcule o Forecast após escolher o mês de destino.' });
      return;
    }
    const months = metadata.areas && metadata.areas.area1 && metadata.areas.area1.months || {};
    const published = Object.entries(months).filter((entry) => entry[1] && entry[1].rowsName);
    if (!published.length) {
      sendJson(response, 400, { error: 'Suba primeiro o relatório de vendas na plataforma.' });
      return;
    }
    for (const [, item] of published) {
      const rowsPath = resolveDataFilePath(item.rowsName);
      if (!fs.existsSync(rowsPath)) continue;
      const saved = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
      const savedRows = Array.isArray(saved.rows) ? saved.rows : [];
      if (!savedRows.length) continue;
      const savedHeader = savedRows[0];
      saved.rows = [savedHeader].concat(savedRows.slice(1).filter((row) => !isForecastRow(row, savedHeader)));
      fs.writeFileSync(rowsPath, JSON.stringify(saved));
    }
    const targetEntry = published.sort((a, b) => Number(a[0]) - Number(b[0])).pop();
    const targetMonth = requestedTargetMonth;
    const target = targetEntry[1];
    const targetPath = resolveDataFilePath(target.rowsName);
    const saved = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    const targetHeader = saved.rows[0];
    const sourceIndexes = Object.fromEntries(header.map((name, index) => [name, index]));
    const normalized = forecastRows.map((row) => targetHeader.map((name) => row[sourceIndexes[name]] == null ? '' : row[sourceIndexes[name]]));
    saved.rows = saved.rows.concat(normalized);
    saved.forecastGeneratedAt = new Date().toISOString();
    fs.writeFileSync(targetPath, JSON.stringify(saved));
    target.rowsUpdatedAt = saved.forecastGeneratedAt;
    metadata.forecast = {
      generated: true,
      generatedAt: saved.forecastGeneratedAt,
      rows: normalized.length,
      targetMonth,
      targetYear: requestedTargetYear,
      period: String(payload.period || ''),
      source: String(payload.source || 'Base de Vendas publicada')
    };
    writeJsonWithRetry(metadataPath, metadata);
    sendJson(response, 200, metadata.forecast);
    setImmediate(() => ensureIntelligentAnalysis(true).catch(() => {}));
  } catch (error) {
    console.error('Erro ao publicar forecast:', error);
    sendJson(response, 500, { error: error.message || 'Erro ao publicar forecast.' });
  }
}

function normalizeAdsText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function adsDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const text = String(value == null ? '' : value).trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function isAdsMetricRow(row, indexes) {
  const category = normalizeAdsText(row[indexes.category]);
  const subcategory = normalizeAdsText(row[indexes.subcategory]);
  return category === 'cliques' || category === 'ads f' ||
    (category === '03.despesas marketplace' && subcategory === 'publicidade');
}

function getRegisteredMarketplaceAccounts() {
  const metadata = readMetadata();
  const months = metadata.areas && metadata.areas.area1 && metadata.areas.area1.months || {};
  const accounts = new Map();
  Object.values(months).forEach((month) => {
    if (!month || !month.rowsName) return;
    const rowsPath = resolveDataFilePath(month.rowsName);
    if (!rowsPath || !fs.existsSync(rowsPath)) return;
    try {
      const payload = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (rows.length < 2) return;
      const header = rows[0].map((value) => String(value == null ? '' : value).trim());
      const findIndex = (aliases) => header.findIndex((name) => aliases.includes(normalizeAdsText(name)));
      const indexes = {
        marketplace: findIndex(['marketplace']), sale: findIndex(['marketplace venda']),
        category: findIndex(['categoria']), subcategory: findIndex(['sub categoria', 'subcategoria']),
        datatype: findIndex(['datatype'])
      };
      if (indexes.marketplace < 0 || indexes.sale < 0) return;
      rows.slice(1).forEach((row) => {
        if (indexes.datatype >= 0 && normalizeAdsText(row[indexes.datatype]) === 'forecast') return;
        const marketplace = String(row[indexes.marketplace] || '').trim();
        const account = String(row[indexes.sale] || '').trim();
        if (!marketplace || !account || isAdsMetricRow(row, indexes)) return;
        const key = normalizeAdsText(marketplace) + '||' + normalizeAdsText(account);
        if (!accounts.has(key)) accounts.set(key, { marketplace, account });
      });
    } catch (error) {
      console.warn('Não foi possível ler contas de', month.rowsName, error.message);
    }
  });
  return Array.from(accounts.values()).sort((a, b) =>
    a.marketplace.localeCompare(b.marketplace, 'pt-BR') || a.account.localeCompare(b.account, 'pt-BR'));
}

async function handleAdsBaseUpload(request, response) {
  if (!requireAdmin(request, response)) return;
  try {
    const payload = await collectJsonRequest(request, maxUploadBytes);
    const month = normalizeMonth(payload.month);
    const platform = String(payload.platform || '').trim();
    const platformKey = normalizeAdsText(platform);
    const account = String(payload.account || '').trim();
    const incomingRows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!month || !account || !['mercado livre', 'shopee'].includes(platformKey)) {
      sendJson(response, 400, { error: 'Selecione um mês e uma plataforma válidos.' });
      return;
    }
    if (!incomingRows.length) {
      sendJson(response, 400, { error: 'Nenhuma linha de ADS foi recebida.' });
      return;
    }

    const metadata = readMetadata();
    const months = metadata.areas && metadata.areas.area1 && metadata.areas.area1.months || {};
    const monthMetadata = months[month];
    if (!monthMetadata || !monthMetadata.rowsName) {
      sendJson(response, 400, { error: 'Publique primeiro a Base de Vendas do mês selecionado.' });
      return;
    }
    const rowsPath = resolveDataFilePath(monthMetadata.rowsName);
    if (!fs.existsSync(rowsPath)) {
      sendJson(response, 404, { error: 'A Base de Dados do mês selecionado não foi encontrada.' });
      return;
    }

    const saved = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
    const savedRows = Array.isArray(saved.rows) ? saved.rows : [];
    if (!savedRows.length || !Array.isArray(savedRows[0])) {
      sendJson(response, 400, { error: 'A Base de Dados publicada não possui cabeçalho válido.' });
      return;
    }
    const header = savedRows[0].map((value) => String(value == null ? '' : value).trim());
    const headerIndex = (aliases) => header.findIndex((name) => aliases.includes(normalizeAdsText(name)));
    const indexes = {
      marketplace: headerIndex(['marketplace']), sale: headerIndex(['marketplace venda']),
      sku: headerIndex(['sku']), ad: headerIndex(['id anuncio']), date: headerIndex(['data']),
      category: headerIndex(['categoria']), subcategory: headerIndex(['sub categoria', 'subcategoria']),
      value: headerIndex(['valor', 'valor completo']), tag: headerIndex(['tag']),
      description: headerIndex(['descricao']), category2: headerIndex(['categoria2']),
      datatype: headerIndex(['datatype']), recordDate: headerIndex(['record date']), fullDate: headerIndex(['full data'])
    };
    const requiredIndexes = ['marketplace', 'sale', 'sku', 'date', 'category', 'subcategory', 'value', 'datatype'];
    if (requiredIndexes.some((name) => indexes[name] < 0)) {
      sendJson(response, 400, { error: 'A Base de Dados publicada não está no formato esperado.' });
      return;
    }

    const accountIsRegistered = savedRows.slice(1).some((row) => {
      const samePlatform = normalizeAdsText(row[indexes.marketplace]) === platformKey;
      const sameAccount = indexes.sale >= 0 && normalizeAdsText(row[indexes.sale]) === normalizeAdsText(account);
      const actual = normalizeAdsText(row[indexes.datatype]) !== 'forecast';
      return samePlatform && sameAccount && actual && !isAdsMetricRow(row, indexes);
    });
    if (!accountIsRegistered) {
      sendJson(response, 400, { error: 'A conta selecionada não está cadastrada na Base de Vendas deste mês.' });
      return;
    }

    const skuData = new Map();
    savedRows.slice(1).forEach((row) => {
      const sku = normalizeAdsText(row[indexes.sku]);
      if (!sku) return;
      const current = skuData.get(sku) || { description: '', category2: '' };
      if (indexes.description >= 0 && !current.description) current.description = String(row[indexes.description] || '').trim();
      if (indexes.category2 >= 0 && !current.category2) current.category2 = String(row[indexes.category2] || '').trim();
      skuData.set(sku, current);
    });

    const uniqueIncomingRows = [];
    const incomingKeys = new Set();
    incomingRows.forEach((row) => {
      const key = [platformKey, normalizeAdsText(account), normalizeAdsText(row.sku), normalizeAdsText(row.ad),
        adsDateKey(row.date), normalizeAdsText(row.category), normalizeAdsText(row.subcategory), Number(row.value) || 0].join('||');
      if (incomingKeys.has(key)) return;
      incomingKeys.add(key);
      uniqueIncomingRows.push(row);
    });
    const dates = new Set(uniqueIncomingRows.map((row) => adsDateKey(row.date)).filter(Boolean));
    if (!dates.size) {
      sendJson(response, 400, { error: 'Nenhuma data válida foi encontrada no arquivo de ADS.' });
      return;
    }
    const datesOutsideSelectedMonth = Array.from(dates).filter((date) => Number(date.slice(5, 7)) !== Number(month));
    if (datesOutsideSelectedMonth.length) {
      sendJson(response, 400, { error: 'O arquivo possui datas fora do mês selecionado. Escolha o mês correto antes de publicar.' });
      return;
    }
    const keptRows = [];
    let replaced = 0;
    savedRows.slice(1).forEach((row) => {
      const samePlatform = normalizeAdsText(row[indexes.marketplace]) === platformKey;
      const sameAccount = normalizeAdsText(row[indexes.sale]) === normalizeAdsText(account);
      const actual = normalizeAdsText(row[indexes.datatype]) !== 'forecast';
      if (samePlatform && sameAccount && actual && isAdsMetricRow(row, indexes)) replaced += 1;
      else keptRows.push(row);
    });

    const now = new Date().toISOString();
    const addedRows = uniqueIncomingRows.map((source) => {
      const row = new Array(header.length).fill('');
      const date = adsDateKey(source.date);
      const sku = String(source.sku || '').trim();
      const known = skuData.get(normalizeAdsText(sku)) || {};
      row[indexes.marketplace] = platform;
      if (indexes.sale >= 0) row[indexes.sale] = account;
      row[indexes.sku] = sku;
      if (indexes.ad >= 0) row[indexes.ad] = String(source.ad || '').trim();
      row[indexes.date] = date;
      row[indexes.category] = String(source.category || '').trim();
      row[indexes.subcategory] = String(source.subcategory || '').trim();
      row[indexes.value] = Number(source.value) || 0;
      if (indexes.tag >= 0) row[indexes.tag] = '';
      if (indexes.description >= 0) row[indexes.description] = known.description || '';
      if (indexes.category2 >= 0) row[indexes.category2] = known.category2 || '';
      row[indexes.datatype] = 'Actual';
      if (indexes.recordDate >= 0) row[indexes.recordDate] = now;
      if (indexes.fullDate >= 0) row[indexes.fullDate] = date;
      return row;
    });

    saved.rows = [header].concat(keptRows, addedRows);
    writeJsonWithRetry(rowsPath, saved);
    monthMetadata.rowsUpdatedAt = now;
    writeJsonWithRetry(metadataPath, metadata);
    sendJson(response, 200, { added: addedRows.length, replaced, duplicatesRemoved: incomingRows.length - uniqueIncomingRows.length, platform, account, month });
    setImmediate(() => ensureIntelligentAnalysis(true).catch(() => {}));
  } catch (error) {
    console.error('Erro ao publicar base de ADS:', error);
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500;
    sendJson(response, status, { error: status === 413 ? 'Arquivo de ADS acima do limite permitido.' : (error.message || 'Erro ao publicar base de ADS.') });
  }
}


function collectJsonRequest(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    request.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });

    request.on('error', reject);
  });
}

function normalizeMasterText(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

function readProductMaster() {
  if (!fs.existsSync(productMasterPath)) {
    return { version: 1, categories: [], skus: {}, updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(productMasterPath, 'utf8'));
    return {
      version: 1,
      categories: Array.isArray(value.categories) ? value.categories : [],
      skus: value.skus && typeof value.skus === 'object' ? value.skus : {},
      updatedAt: value.updatedAt || null
    };
  } catch (error) {
    return { version: 1, categories: [], skus: {}, updatedAt: null };
  }
}

function applyProductCategoriesToRowsFile(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return;
  const headers = rows[0].map((header) => String(header || '').trim());
  const normalizedHeaders = headers.map(normalizeMasterText);
  const skuIndex = normalizedHeaders.indexOf('sku');
  if (skuIndex < 0) return;
  let categoryIndex = normalizedHeaders.findIndex((header) => ['categoria2', 'categoria 2'].includes(header));
  if (categoryIndex < 0) {
    categoryIndex = headers.length;
    headers.push('Categoria2');
    rows[0] = headers;
  }
  const descriptionIndex = normalizedHeaders.findIndex((header) => ['descricao', 'titulo do anuncio'].includes(header));
  const marketplaceIndex = normalizedHeaders.indexOf('marketplace');
  const master = readProductMaster();
  const categoryNames = Object.fromEntries((master.categories || []).map((category) => [category.id, category.name]));
  let masterChanged = false;
  rows.slice(1).forEach((row) => {
    const sku = String(row[skuIndex] || '').trim();
    if (!sku) return;
    const existing = master.skus[sku] || {};
    if (!existing.sku) masterChanged = true;
    master.skus[sku] = {
      sku,
      description: existing.description || String(row[descriptionIndex] || '').trim(),
      marketplace: existing.marketplace || String(row[marketplaceIndex] || '').trim(),
      categoryId: existing.categoryId || '',
      firstSeen: existing.firstSeen || new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    row[categoryIndex] = categoryNames[master.skus[sku].categoryId] || '';
  });
  payload.rows = rows;
  fs.writeFileSync(filePath, JSON.stringify(payload));
  if (masterChanged) {
    master.updatedAt = new Date().toISOString();
    writeJsonWithRetry(productMasterPath, master);
  }
}

function syncProductMasterFromPublishedRows(master) {
  const metadata = readMetadata();
  const months = Object.values(metadata.areas.area1 && metadata.areas.area1.months || {});
  let changed = false;

  months.forEach((month) => {
    const rowsName = month && month.rowsName;
    const rowsPath = rowsName ? resolveDataFilePath(rowsName) : '';
    if (!rowsPath || !fs.existsSync(rowsPath)) return;
    try {
      const payload = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const headers = rows[0] || [];
      const findIndex = (aliases) => headers.findIndex((header) => aliases.includes(normalizeMasterText(header)));
      const skuIndex = findIndex(['sku']);
      const descriptionIndex = findIndex(['descricao', 'descrição', 'descria§ao', 'titulo do anuncio', 'título do anúncio']);
      const marketplaceIndex = findIndex(['marketplace']);
      if (skuIndex < 0) return;
      rows.slice(1).forEach((row) => {
        const sku = String(row[skuIndex] || '').trim();
        if (!sku) return;
        const existing = master.skus[sku] || {};
        master.skus[sku] = {
          sku,
          description: existing.description || String(row[descriptionIndex] || '').trim(),
          marketplace: existing.marketplace || String(row[marketplaceIndex] || '').trim(),
          categoryId: existing.categoryId || '',
          firstSeen: existing.firstSeen || month.updatedAt || new Date().toISOString(),
          lastSeen: month.updatedAt || existing.lastSeen || new Date().toISOString()
        };
        if (!existing.sku) changed = true;
      });
    } catch (error) {
      console.warn('Nao foi possivel sincronizar SKUs de', rowsName, error.message);
    }
  });

  if (changed) {
    master.updatedAt = new Date().toISOString();
    writeJsonWithRetry(productMasterPath, master);
  }
  return master;
}

async function handleProductMasterUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 2 * 1024 * 1024);
    const master = syncProductMasterFromPublishedRows(readProductMaster());
    if (payload.action === 'add-category') {
      const name = String(payload.name || '').trim().replace(/\s+/g, ' ');
      const normalized = normalizeMasterText(name);
      if (!name) return sendJson(response, 400, { error: 'Informe o nome da categoria.' });
      if (master.categories.some((item) => normalizeMasterText(item.name) === normalized)) {
        return sendJson(response, 409, { error: 'Essa categoria ja esta cadastrada.' });
      }
      master.categories.push({ id: crypto.randomUUID(), name, normalized, createdAt: new Date().toISOString() });
      master.categories.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    } else if (payload.action === 'assign-sku') {
      const sku = String(payload.sku || '').trim();
      const categoryId = String(payload.categoryId || '').trim();
      if (!master.skus[sku]) return sendJson(response, 404, { error: 'SKU nao encontrado.' });
      if (categoryId && !master.categories.some((item) => item.id === categoryId)) {
        return sendJson(response, 400, { error: 'Categoria invalida.' });
      }
      master.skus[sku].categoryId = categoryId;
    } else if (payload.action === 'assign-skus') {
      const skus = Array.isArray(payload.skus)
        ? [...new Set(payload.skus.map((sku) => String(sku || '').trim()).filter(Boolean))]
        : [];
      const categoryId = String(payload.categoryId || '').trim();
      if (!skus.length) return sendJson(response, 400, { error: 'Nenhum SKU foi selecionado.' });
      if (!categoryId || !master.categories.some((item) => item.id === categoryId)) {
        return sendJson(response, 400, { error: 'Selecione uma categoria valida.' });
      }
      skus.forEach((sku) => {
        if (master.skus[sku]) master.skus[sku].categoryId = categoryId;
      });
    } else {
      return sendJson(response, 400, { error: 'Acao invalida.' });
    }
    master.updatedAt = new Date().toISOString();
    writeJsonWithRetry(productMasterPath, master);
    sendJson(response, 200, master);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

function handleApplyProductCategories(request, response) {
  try {
    const metadata = readMetadata();
    const months = metadata.areas && metadata.areas.area1 && metadata.areas.area1.months || {};
    const master = readProductMaster();
    const categoryNames = Object.fromEntries((master.categories || []).map((category) => [category.id, category.name]));
    const categorizedSkus = new Set(Object.values(master.skus || {})
      .filter((item) => item.categoryId && categoryNames[item.categoryId])
      .map((item) => String(item.sku || '').trim()));
    let files = 0;
    let rows = 0;
    let updatedRows = 0;
    const updatedAt = new Date().toISOString();

    Object.values(months).forEach((month) => {
      if (!month || !month.rowsName) return;
      const rowsPath = resolveDataFilePath(month.rowsName);
      if (!fs.existsSync(rowsPath)) return;
      applyProductCategoriesToRowsFile(rowsPath);
      const payload = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
      const savedRows = Array.isArray(payload.rows) ? payload.rows : [];
      const headers = savedRows[0] || [];
      const skuIndex = headers.findIndex((header) => normalizeMasterText(header) === 'sku');
      const categoryIndex = headers.findIndex((header) => ['categoria2', 'categoria 2'].includes(normalizeMasterText(header)));
      savedRows.slice(1).forEach((row) => {
        rows += 1;
        if (skuIndex >= 0 && categoryIndex >= 0 && categorizedSkus.has(String(row[skuIndex] || '').trim()) && String(row[categoryIndex] || '').trim()) {
          updatedRows += 1;
        }
      });
      month.rowsUpdatedAt = updatedAt;
      files += 1;
    });

    writeJsonWithRetry(metadataPath, metadata);
    sendJson(response, 200, { files, rows, updatedRows, categorizedSkus: categorizedSkus.size, updatedAt });
    setImmediate(() => ensureIntelligentAnalysis(true).catch(() => {}));
  } catch (error) {
    console.error('Erro ao aplicar categorias na base:', error);
    sendJson(response, 500, { error: error.message || 'Nao foi possivel atualizar as categorias da base.' });
  }
}

function readInventory() {
  if (!fs.existsSync(inventoryPath)) {
    return { version: 1, entries: [], links: {}, updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    return {
      version: 1,
      entries: Array.isArray(value.entries) ? value.entries : [],
      links: value.links && typeof value.links === 'object' ? value.links : {},
      updatedAt: value.updatedAt || null
    };
  } catch (error) {
    return { version: 1, entries: [], links: {}, updatedAt: null };
  }
}

function readInventoryFull() {
  if (!fs.existsSync(inventoryFullPath)) {
    return { version: 2, companies: {}, updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(inventoryFullPath, 'utf8'));
    if (value.companies && typeof value.companies === 'object') {
      const companies = {};
      Object.entries(value.companies).forEach(([account, dataset]) => {
        if (!dataset || typeof dataset !== 'object') return;
        companies[account] = {
          account, rows: Array.isArray(dataset.rows) ? dataset.rows : [],
          sourceFile: String(dataset.sourceFile || ''), sourceUpdatedAt: String(dataset.sourceUpdatedAt || ''),
          importedAt: dataset.importedAt || null,
          capacity: dataset.capacity && typeof dataset.capacity === 'object' ? dataset.capacity : {}
        };
      });
      return { version: 2, companies, updatedAt: value.updatedAt || null };
    }
    const legacyAccount = String(value.account || 'Conta não identificada').trim();
    return {
      version: 2,
      companies: Array.isArray(value.rows) && value.rows.length ? { [legacyAccount]: {
        account: legacyAccount, rows: value.rows, sourceFile: String(value.sourceFile || ''),
        sourceUpdatedAt: String(value.sourceUpdatedAt || ''), importedAt: value.importedAt || null,
        capacity: value.capacity && typeof value.capacity === 'object' ? value.capacity : {}
      } } : {},
      updatedAt: value.importedAt || null
    };
  } catch (error) {
    return { version: 2, companies: {}, updatedAt: null };
  }
}

async function handleInventoryFullUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 25 * 1024 * 1024);
    if (payload.action !== 'replace' || !Array.isArray(payload.rows)) {
      return sendJson(response, 400, { error: 'Arquivo de Estoque Full invalido.' });
    }
    const account = String(payload.account || '').trim();
    if (!account) return sendJson(response, 400, { error: 'Selecione a empresa do Mercado Livre.' });
    const registered = getRegisteredMarketplaceAccounts().some((item) =>
      normalizeAdsText(item.marketplace) === 'mercado livre' && normalizeAdsText(item.account) === normalizeAdsText(account));
    if (!registered) return sendJson(response, 400, { error: 'A empresa selecionada não está cadastrada no Mercado Livre da plataforma.' });
    const inventoryFull = readInventoryFull();
    inventoryFull.companies[account] = {
      account,
      rows: payload.rows.slice(0, 100000),
      sourceFile: String(payload.sourceFile || '').slice(0, 260),
      sourceUpdatedAt: String(payload.sourceUpdatedAt || '').slice(0, 200),
      importedAt: new Date().toISOString(),
      capacity: payload.capacity && typeof payload.capacity === 'object' ? payload.capacity : {}
    };
    inventoryFull.version = 2;
    inventoryFull.updatedAt = new Date().toISOString();
    writeJsonWithRetry(inventoryFullPath, inventoryFull);
    sendJson(response, 200, inventoryFull);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

function readSalesTreaters() {
  if (!fs.existsSync(salesTreatersPath)) return { version: 1, channels: [], updatedAt: null };
  try {
    const value = JSON.parse(fs.readFileSync(salesTreatersPath, 'utf8'));
    return { version: 1, channels: Array.isArray(value.channels) ? value.channels : [], updatedAt: value.updatedAt || null };
  } catch (error) {
    return { version: 1, channels: [], updatedAt: null };
  }
}

async function handleSalesTreatersUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 1024 * 1024);
    const state = readSalesTreaters();
    if (payload.action === 'upsert-channel') {
      const marketplace = String(payload.marketplace || '').trim();
      const channelName = String(payload.channelName || '').trim();
      const taxRate = Number(payload.taxRate);
      const marketplaceKey = normalizeAdsText(marketplace);
      if (!['mercado livre', 'shopee', 'tiktok', 'amazon', 'magalu'].includes(marketplaceKey)) return sendJson(response, 400, { error: 'Marketplace ainda não disponível no Tratador de Vendas.' });
      if (!channelName) return sendJson(response, 400, { error: 'Informe o nome do canal/conta.' });
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return sendJson(response, 400, { error: 'Informe uma alíquota de imposto válida.' });
      const anticipationRate = marketplaceKey === 'shopee' ? Number(payload.anticipationRate) : 0;
      const freight = marketplaceKey === 'shopee' ? Number(payload.freight) : 0;
      if (!Number.isFinite(anticipationRate) || anticipationRate < 0 || anticipationRate > 100) return sendJson(response, 400, { error: 'Informe uma antecipação válida.' });
      if (!Number.isFinite(freight)) return sendJson(response, 400, { error: 'Informe um frete válido.' });
      const id = String(payload.id || '').trim();
      const current = state.channels.find((item) => item.id === id);
      const duplicate = state.channels.find((item) => item.id !== id && normalizeAdsText(item.marketplace) === normalizeAdsText(marketplace) && normalizeAdsText(item.channelName) === normalizeAdsText(channelName));
      if (duplicate) return sendJson(response, 400, { error: 'Este canal já está cadastrado.' });
      const item = { id: current && current.id || crypto.randomUUID(), marketplace, channelName, taxRate, anticipationRate, freight, active: payload.active !== false, updatedAt: new Date().toISOString() };
      if (current) Object.assign(current, item); else state.channels.push(item);
    } else if (payload.action === 'delete-channel') {
      const index = state.channels.findIndex((item) => item.id === String(payload.id || ''));
      if (index < 0) return sendJson(response, 404, { error: 'Canal não encontrado.' });
      state.channels.splice(index, 1);
    } else if (payload.action === 'record-treatment') {
      const channel = state.channels.find((item) => item.id === String(payload.id || ''));
      if (!channel) return sendJson(response, 404, { error: 'Canal nao encontrado.' });
      const month = normalizeMonth(payload.month);
      const year = Math.trunc(Number(payload.year));
      const rowCount = Math.max(0, Math.trunc(Number(payload.rowCount) || 0));
      const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
      if (!month) return sendJson(response, 400, { error: 'Informe a competencia do relatorio.' });
      const firstDate = isoDate(payload.firstDate);
      const lastDate = isoDate(payload.lastDate);
      const resolvedYear = year >= 2000 && year <= 2200
        ? year
        : Number((firstDate || lastDate || new Date().toISOString()).slice(0, 4));
      const history = Array.isArray(channel.treatmentHistory) ? channel.treatmentHistory : [];
      const record = {
        month,
        year: resolvedYear,
        rowCount,
        firstDate,
        lastDate,
        sourceFile: String(payload.sourceFile || '').trim().slice(0, 260),
        missingCostSkus: Math.max(0, Math.trunc(Number(payload.missingCostSkus) || 0)),
        uploadedAt: new Date().toISOString()
      };
      const existingIndex = history.findIndex((item) => String(item.month) === month && Number(item.year) === resolvedYear);
      if (existingIndex >= 0) history[existingIndex] = record; else history.push(record);
      channel.treatmentHistory = history
        .sort((a, b) => Number(a.year) - Number(b.year) || Number(a.month) - Number(b.month))
        .slice(-120);
      channel.updatedAt = new Date().toISOString();
    } else {
      return sendJson(response, 400, { error: 'Ação inválida para o tratador de vendas.' });
    }
    state.updatedAt = new Date().toISOString();
    writeJsonWithRetry(salesTreatersPath, state);
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON inválido.' : error.message });
  }
}

function readMagaluIds() {
  const filePath = path.join(__dirname, 'lib', 'magalu-ids.csv');
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const result = {};
  lines.slice(1).forEach((line) => {
    const separator = line.indexOf(',');
    if (separator < 0) return;
    const id = line.slice(0, separator).trim(), sku = line.slice(separator + 1).trim();
    if (id && sku && !result[id]) result[id] = sku;
  });
  return result;
}

async function handleMarketplaceSalesTransform(request, response, marketplaceKey) {
  try {
    const payload = await collectJsonRequest(request, 80 * 1024 * 1024);
    const state = readSalesTreaters();
    const channel = state.channels.find((item) => item.id === String(payload.channelId || ''));
    if (!channel) return sendJson(response, 404, { error: 'Canal não encontrado.' });
    if (normalizeAdsText(channel.marketplace) !== marketplaceKey) return sendJson(response, 400, { error: 'O canal selecionado não pertence a este marketplace.' });
    const input = Object.assign({}, payload, { channelName: channel.channelName, taxRate: channel.taxRate });
    let result;
    if (marketplaceKey === 'tiktok') result = transformTikTok(input, readPricingDatabase());
    else if (marketplaceKey === 'amazon') result = transformAmazon(input, readPricingDatabase());
    else if (marketplaceKey === 'magalu') result = transformMagalu(input, readPricingDatabase(), readMagaluIds());
    else return sendJson(response, 400, { error: 'Marketplace inválido.' });
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'Arquivo do marketplace inválido.' : error.message });
  }
}

async function handleShopeeSalesTransform(request, response) {
  try {
    const payload = await collectJsonRequest(request, 50 * 1024 * 1024);
    const state = readSalesTreaters();
    const channel = state.channels.find((item) => item.id === String(payload.channelId || ''));
    if (!channel) return sendJson(response, 404, { error: 'Canal não encontrado.' });
    if (normalizeAdsText(channel.marketplace) !== 'shopee') return sendJson(response, 400, { error: 'Este canal não é da Shopee.' });
    const result = transformShopee({
      headers: payload.headers,
      rows: payload.rows,
      channelName: channel.channelName,
      taxRate: channel.taxRate,
      anticipationRate: channel.anticipationRate,
      freight: channel.freight
    }, readPricingDatabase());
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'Arquivo da Shopee inválido.' : error.message });
  }
}

async function handleInventoryUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 2 * 1024 * 1024);
    const inventory = readInventory();

    if (payload.action === 'add-entry') {
      const invoice = String(payload.invoice || '').trim();
      const supplier = String(payload.supplier || '').trim();
      const date = String(payload.date || '').trim();
      const inputSku = String(payload.inputSku || '').trim();
      const salesSku = String(payload.salesSku || '').trim();
      const quantity = Number(payload.quantity);
      const unitCost = Number(payload.unitCost);

      if (!invoice || !supplier || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !inputSku || !salesSku) {
        return sendJson(response, 400, { error: 'Preencha NF, fornecedor, data, SKU de entrada e SKU de venda.' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        return sendJson(response, 400, { error: 'Quantidade e custo unitario devem ser numeros validos.' });
      }

      inventory.entries.push({
        id: crypto.randomUUID(),
        invoice,
        supplier,
        date,
        inputSku,
        salesSku,
        quantity,
        unitCost,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
        createdAt: new Date().toISOString()
      });
      inventory.links[inputSku] = salesSku;
    } else if (payload.action === 'delete-entry') {
      const id = String(payload.id || '').trim();
      const nextEntries = inventory.entries.filter((entry) => entry.id !== id);
      if (nextEntries.length === inventory.entries.length) {
        return sendJson(response, 404, { error: 'Lancamento nao encontrado.' });
      }
      inventory.entries = nextEntries;
    } else {
      return sendJson(response, 400, { error: 'Acao de estoque invalida.' });
    }

    inventory.updatedAt = new Date().toISOString();
    writeJsonWithRetry(inventoryPath, inventory);
    sendJson(response, 200, inventory);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

const defaultPricingRules = [
  { id: 'mercado-livre', name: 'Mercado Livre', commissionRate: 16, fixedFee: 0, freightMode: 'mercado-livre', notes: 'Comissão configurável entre 10% e 19%. Frete por faixa de preço e peso.' },
  { id: 'shopee', name: 'Shopee', commissionRate: 14, fixedFee: 0, freightMode: 'shopee', notes: 'Até R$ 79,99: 20% + R$ 4. Demais faixas: 14% + tarifa fixa. Subsídio PIX desconsiderado.' },
  { id: 'amazon-dba', name: 'Amazon DBA', commissionRate: 12, fixedFee: 1, freightMode: 'amazon-dba', notes: 'Comissão por categoria entre 10% e 15%, mínimo de R$ 1. Frete DBA por preço, peso e região.' },
  { id: 'amazon-fba', name: 'Amazon FBA', commissionRate: 12, fixedFee: 1, freightMode: 'amazon-fba', notes: 'Comissão por categoria entre 10% e 15%, mínimo de R$ 1. Tarifa FBA por preço e peso.' },
  { id: 'magalu', name: 'Magalu', commissionRate: 14.8, fixedFee: 0, freightMode: 'magalu', notes: 'Comissões informadas: 14,80%, 18% ou 40%. Frete por peso.' },
  { id: 'magalu-full', name: 'Magalu Full', commissionRate: 14.8, fixedFee: 0, freightMode: 'magalu-full', notes: 'Frete Full com desconto de 75% conforme tabela do anexo.' },
  { id: 'tiktok', name: 'TikTok', commissionRate: 12, fixedFee: 4, freightMode: 'none', notes: 'Comissão de 12% + R$ 4,00 por item.' },
  { id: 'shein', name: 'Shein', commissionRate: 18, fixedFee: 0, freightMode: 'shein', notes: 'Abaixo de R$ 79,99: 18% + R$ 5. Acima: 18% + intermediação de frete por peso.' }
];

function readPricingRules() {
  if (!fs.existsSync(pricingRulesPath)) {
    return { version: 1, rules: defaultPricingRules, updatedAt: null, source: 'COMISSOES E FRETE DOS MARKETPLACES.pdf' };
  }
  try {
    const value = JSON.parse(fs.readFileSync(pricingRulesPath, 'utf8'));
    return {
      version: 1,
      rules: (Array.isArray(value.rules) ? value.rules : defaultPricingRules).map((rule) => ({
        ...rule,
        couponRate: Number(rule.couponRate) || 0,
        adsRate: Number(rule.adsRate) || 0,
        affiliatesRate: Number(rule.affiliatesRate) || 0,
        taxRate: Number(rule.taxRate) || 0
      })),
      updatedAt: value.updatedAt || null,
      source: value.source || 'COMISSOES E FRETE DOS MARKETPLACES.pdf'
    };
  } catch (error) {
    return { version: 1, rules: defaultPricingRules, updatedAt: null, source: 'COMISSOES E FRETE DOS MARKETPLACES.pdf' };
  }
}

async function handlePricingRulesUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 512 * 1024);
    if (payload.action !== 'update-rule') return sendJson(response, 400, { error: 'Acao invalida.' });
    const state = readPricingRules();
    const rule = state.rules.find((item) => item.id === String(payload.id || ''));
    if (!rule) return sendJson(response, 404, { error: 'Marketplace nao encontrado.' });
    const commissionRate = Number(payload.commissionRate);
    const fixedFee = Number(payload.fixedFee);
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 100 || !Number.isFinite(fixedFee) || fixedFee < 0) {
      return sendJson(response, 400, { error: 'Comissao ou tarifa fixa invalida.' });
    }
    rule.commissionRate = commissionRate;
    rule.fixedFee = fixedFee;
    ['couponRate', 'adsRate', 'affiliatesRate', 'taxRate'].forEach((field) => {
      const value = Number(payload[field]);
      if (!Number.isFinite(value) || value < 0 || value >= 100) throw new Error(`${field} invalido.`);
      rule[field] = value;
    });
    rule.notes = String(payload.notes || '').trim();
    state.updatedAt = new Date().toISOString();
    writeJsonWithRetry(pricingRulesPath, state);
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

function readPricingDatabase() {
  if (!fs.existsSync(pricingDatabasePath)) {
    return { version: 2, costs: {}, history: [], lastPricing: {}, updatedAt: null };
  }
  try {
    const value = JSON.parse(fs.readFileSync(pricingDatabasePath, 'utf8'));
    return {
      version: 2,
      costs: value.costs && typeof value.costs === 'object' ? value.costs : {},
      history: Array.isArray(value.history) ? value.history : [],
      lastPricing: value.lastPricing && typeof value.lastPricing === 'object' ? value.lastPricing : {},
      updatedAt: value.updatedAt || null
    };
  } catch (error) {
    return { version: 2, costs: {}, history: [], lastPricing: {}, updatedAt: null };
  }
}

function validNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} invalido.`);
  return number;
}

async function handlePricingDatabaseUpdate(request, response) {
  try {
    const payload = await collectJsonRequest(request, 12 * 1024 * 1024);
    const state = readPricingDatabase();
    const now = new Date().toISOString();

    if (payload.action === 'upsert-cost') {
      const sku = String(payload.sku || '').trim();
      if (!sku) return sendJson(response, 400, { error: 'Informe o SKU.' });
      const productCost = validNonNegativeNumber(payload.productCost, 'Custo do produto');
      const realWeight = validNonNegativeNumber(payload.realWeight, 'Peso real');
      const height = validNonNegativeNumber(payload.height, 'Altura');
      const width = validNonNegativeNumber(payload.width, 'Largura');
      const length = validNonNegativeNumber(payload.length, 'Comprimento');
      const cubedWeight = Math.round(((height * width * length) / 6000) * 10000) / 10000;
      const consideredWeight = Math.max(realWeight, cubedWeight);
      state.costs[sku] = {
        sku,
        description: String(payload.description || '').trim(),
        category: String(payload.category || '').trim(),
        productCost,
        realWeight,
        height,
        width,
        length,
        cubedWeight,
        consideredWeight,
        updatedAt: now,
        responsible: String(payload.responsible || '').trim() || 'Nao informado'
      };
    } else if (payload.action === 'import-costs') {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) return sendJson(response, 400, { error: 'Nenhum produto valido para importar.' });
      if (rows.length > 50000) return sendJson(response, 400, { error: 'O arquivo excede 50.000 produtos.' });
      let created = 0;
      let updated = 0;
      rows.forEach((row, index) => {
        const sku = String(row.sku || '').trim();
        if (!sku) throw new Error(`SKU ausente na linha ${index + 2}.`);
        const productCost = validNonNegativeNumber(row.productCost, `Custo da linha ${index + 2}`);
        const realWeight = validNonNegativeNumber(row.realWeight, `Peso da linha ${index + 2}`);
        const height = validNonNegativeNumber(row.height, `Altura da linha ${index + 2}`);
        const width = validNonNegativeNumber(row.width, `Largura da linha ${index + 2}`);
        const length = validNonNegativeNumber(row.length, `Comprimento da linha ${index + 2}`);
        const cubedWeight = Math.round(((height * width * length) / 6000) * 10000) / 10000;
        if (state.costs[sku]) updated += 1;
        else created += 1;
        state.costs[sku] = {
          sku,
          description: String(row.description || '').trim(),
          category: String(row.category || '').trim(),
          productCost,
          realWeight,
          height,
          width,
          length,
          cubedWeight,
          consideredWeight: Math.max(realWeight, cubedWeight),
          updatedAt: now,
          responsible: String(payload.responsible || row.responsible || '').trim() || 'Importacao CSV'
        };
      });
      state.importSummary = { received: rows.length, created, updated };
    } else if (payload.action === 'save-last-pricing') {
      const sku = String(payload.sku || '').trim();
      if (!sku) return sendJson(response, 400, { error: 'SKU obrigatorio.' });
      state.lastPricing[sku] = {
        sku,
        createdAt: now,
        user: String(payload.user || '').trim() || 'Nao informado',
        description: String(payload.description || '').trim(),
        calculationMode: payload.calculationMode === 'margin' ? 'margin' : 'price',
        salePrice: validNonNegativeNumber(payload.salePrice, 'Preco de venda'),
        desiredMargin: validNonNegativeNumber(payload.desiredMargin, 'Margem desejada'),
        selectedMarketplaces: Array.isArray(payload.selectedMarketplaces) ? payload.selectedMarketplaces.map(String) : [],
        marketplaceSettings: payload.marketplaceSettings && typeof payload.marketplaceSettings === 'object' ? payload.marketplaceSettings : {}
      };
    } else {
      return sendJson(response, 400, { error: 'Acao de precificacao invalida.' });
    }

    state.updatedAt = now;
    writeJsonWithRetry(pricingDatabasePath, state);
    sendJson(response, 200, state);
  } catch (error) {
    sendJson(response, 400, { error: error.message === 'INVALID_JSON' ? 'JSON invalido.' : error.message });
  }
}

function extractResponseText(payload) {
  if (payload && typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const texts = [];
  const visit = (value, parentKey) => {
    if (typeof value === 'string') {
      if ((parentKey === 'text' || parentKey === 'output_text') && value.trim()) {
        texts.push(value.trim());
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentKey));
      return;
    }

    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => visit(child, key));
    }
  };

  visit(payload && payload.output, 'output');
  return Array.from(new Set(texts)).join('\n\n').trim();
}

function normalizeAnalysisText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAnalysisNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value || '').trim();
  if (!text) {
    return 0;
  }

  const negative = /^-/.test(text) || /^\(.*\)$/.test(text);
  text = text.replace(/[^0-9,.\-]/g, '');

  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number(text.replace(/[()]/g, ''));
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return negative ? -Math.abs(parsed) : parsed;
}

function findAnalysisHeader(headers, names) {
  const normalizedNames = names.map(normalizeAnalysisText);
  return headers.findIndex((header) => normalizedNames.includes(normalizeAnalysisText(header)));
}

function isActualAnalysisValue(value) {
  return ['actual', 'atual', 'real', 'realizado'].includes(normalizeAnalysisText(value));
}

function isForecastAnalysisValue(value) {
  return ['forecast', 'previsao', 'previsto', 'orcado', 'budget'].includes(normalizeAnalysisText(value));
}

function parseAnalysisDateParts(value, expectedMonth, expectedYear) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { day: value.getDate(), month: value.getMonth() + 1, year: value.getFullYear() };
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 20000) {
    const excelDate = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return {
      day: excelDate.getUTCDate(),
      month: excelDate.getUTCMonth() + 1,
      year: excelDate.getUTCFullYear()
    };
  }

  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})/);
  if (!match) {
    return null;
  }

  let first = Number(match[1]);
  let second = Number(match[2]);
  let third = Number(match[3]);
  if (first > 999) {
    return { day: third, month: second, year: first };
  }
  const year = third < 100 ? 2000 + third : third;
  let day = first;
  let month = second;

  if (first === expectedMonth && second <= 31) {
    month = first;
    day = second;
  } else if (second === expectedMonth && first <= 31) {
    month = second;
    day = first;
  } else if (first <= 12 && second > 12) {
    month = first;
    day = second;
  }

  return { day, month, year: year || expectedYear };
}

function getSaoPauloDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(values.day),
    month: Number(values.month),
    year: Number(values.year)
  };
}

function readPublishedRows(monthMetadata) {
  if (!monthMetadata || !monthMetadata.rowsName) {
    return [];
  }

  const rowsPath = resolveDataFilePath(monthMetadata.rowsName);
  if (!fs.existsSync(rowsPath)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));
    return Array.isArray(payload.rows) ? payload.rows : [];
  } catch (error) {
    console.warn('Nao foi possivel ler dados processados para analise inteligente:', error.message);
    return [];
  }
}

function createEmptyMetricBucket(name) {
  return {
    name: String(name || '(vazio)'),
    revenue: 0,
    netRevenue: 0,
    quantity: 0,
    gm: 0,
    advertising: 0,
    affiliates: 0,
    adsRevenue: 0,
    orders: new Set(),
    ads: new Set(),
    channelRevenue: new Map()
  };
}

function addMetricBucket(target, source) {
  target.revenue += source.revenue || 0;
  target.netRevenue += source.netRevenue || 0;
  target.quantity += source.quantity || 0;
  target.gm += source.gm || 0;
  target.advertising += source.advertising || 0;
  target.affiliates += source.affiliates || 0;
  target.adsRevenue += source.adsRevenue || 0;
  source.orders.forEach((value) => target.orders.add(value));
  source.ads.forEach((value) => target.ads.add(value));
  source.channelRevenue.forEach((value, channel) => {
    target.channelRevenue.set(channel, (target.channelRevenue.get(channel) || 0) + value);
  });
}

function finalizeMetricBucket(bucket) {
  const attributedRevenue = Math.abs(bucket.adsRevenue || 0);

  return {
    name: bucket.name,
    revenue: bucket.revenue,
    netRevenue: bucket.netRevenue,
    quantity: bucket.quantity,
    orders: bucket.orders.size || null,
    averageTicket: bucket.quantity === 0 ? 0 : bucket.revenue / bucket.quantity,
    gm: bucket.gm,
    gmPercent: bucket.netRevenue === 0 ? 0 : bucket.gm / bucket.netRevenue,
    advertising: Math.abs(bucket.advertising),
    affiliates: Math.abs(bucket.affiliates),
    adsRevenue: attributedRevenue,
    tacos: bucket.revenue === 0 ? 0 : Math.abs(bucket.advertising) / bucket.revenue,
    acos: attributedRevenue === 0 ? null : Math.abs(bucket.advertising) / attributedRevenue,
    roas: bucket.advertising === 0 ? null : attributedRevenue / Math.abs(bucket.advertising),
    adsRevenueShare: bucket.revenue === 0 ? 0 : attributedRevenue / bucket.revenue,
    ads: bucket.ads.size,
    channels: Array.from(bucket.channelRevenue.entries())
      .map(([name, revenue]) => ({
        name,
        revenue,
        share: bucket.revenue === 0 ? 0 : revenue / bucket.revenue
      }))
      .filter((item) => item.revenue !== 0)
      .sort((a, b) => b.revenue - a.revenue)
  };
}

function aggregatePublishedScenario(rows, month, year, scenarioKind, options) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return null;
  }

  const headers = rows[0].map((header) => String(header || ''));
  const indexes = {
    category: findAnalysisHeader(headers, ['Categoria']),
    category2: findAnalysisHeader(headers, ['Categoria2', 'Categoria 2']),
    subcategory: findAnalysisHeader(headers, ['Sub Categoria', 'Subcategoria', 'Sub-Categoria']),
    marketplace: findAnalysisHeader(headers, ['Marketplace']),
    marketplaceSale: findAnalysisHeader(headers, ['Marketplace venda']),
    sku: findAnalysisHeader(headers, ['SKU']),
    ad: findAnalysisHeader(headers, ['Id anuncio', 'Id anúncio', 'ID do anuncio', 'Anúncio']),
    order: findAnalysisHeader(headers, ['ID do pedido', 'Id pedido', 'Pedido']),
    date: findAnalysisHeader(headers, ['Data', 'Full Data', 'Record Date']),
    scenario: findAnalysisHeader(headers, ['Datatype', 'Data Type', 'Tipo de dado', 'Tipo dados']),
    amount: findAnalysisHeader(headers, ['Valor completo', 'Actual', 'Valor', 'Faturamento', 'Total'])
  };
  const groups = {
    marketplaces: new Map(),
    categories: new Map(),
    skus: new Map(),
    ads: new Map()
  };
  const total = createEmptyMetricBucket('Total');
  const rawGroups = new Map();
  const availableDays = new Set();
  let latestDay = 0;
  const cutoffDay = Number(options && options.cutoffDay) || 0;
  const limitDistinctDates = Number(options && options.limitDistinctDates) || 0;
  let allowedForecastDates = null;

  if (scenarioKind === 'forecast' && limitDistinctDates && indexes.date >= 0) {
    const dates = new Set();
    rows.slice(1).forEach((row) => {
      if (indexes.scenario >= 0 && !isForecastAnalysisValue(row[indexes.scenario])) return;
      const parts = parseAnalysisDateParts(row[indexes.date], Number(month), year);
      if (!parts) return;
      dates.add(String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0'));
    });
    allowedForecastDates = new Set(Array.from(dates).sort().slice(0, limitDistinctDates));
  }

  rows.slice(1).forEach((row) => {
    const scenario = indexes.scenario >= 0 ? row[indexes.scenario] : 'actual';
    const matchesScenario = scenarioKind === 'forecast'
      ? isForecastAnalysisValue(scenario)
      : isActualAnalysisValue(scenario);
    if (!matchesScenario) {
      return;
    }
    const dateParts = indexes.date >= 0
      ? parseAnalysisDateParts(row[indexes.date], Number(month), year)
      : null;
    if (allowedForecastDates && dateParts) {
      const dateKey = String(dateParts.year).padStart(4, '0') + '-' + String(dateParts.month).padStart(2, '0') + '-' + String(dateParts.day).padStart(2, '0');
      if (!allowedForecastDates.has(dateKey)) return;
    }
    if (dateParts && dateParts.month === Number(month)) {
      if (cutoffDay && dateParts.day > cutoffDay) {
        return;
      }
    }

    const category = indexes.category >= 0 ? String(row[indexes.category] || '') : '';
    const category2 = indexes.category2 >= 0 ? String(row[indexes.category2] || '(vazio)') : '(vazio)';
    const subcategory = indexes.subcategory >= 0 ? String(row[indexes.subcategory] || '') : '';
    const marketplace = indexes.marketplace >= 0 ? String(row[indexes.marketplace] || '(vazio)') : '(vazio)';
    const marketplaceSale = indexes.marketplaceSale >= 0 ? String(row[indexes.marketplaceSale] || '(vazio)') : '(vazio)';
    const sku = indexes.sku >= 0 ? String(row[indexes.sku] || '(vazio)') : '(vazio)';
    const ad = indexes.ad >= 0 ? String(row[indexes.ad] || '(vazio)') : '(vazio)';
    const order = indexes.order >= 0 ? String(row[indexes.order] || '').trim() : '';
    const amount = indexes.amount >= 0 ? parseAnalysisNumber(row[indexes.amount]) : 0;
    if (dateParts && dateParts.month === Number(month) && amount !== 0) {
      latestDay = Math.max(latestDay, dateParts.day);
      availableDays.add(dateParts.day);
    }
    const key = [marketplace, marketplaceSale, category2, sku, ad].join('||');
    const bucket = rawGroups.get(key) || {
      marketplace,
      marketplaceSale,
      category2,
      sku,
      ad,
      orders: new Set(),
      revenue: 0,
      tax: 0,
      marketplaceExpenses: 0,
      costs: 0,
      quantity: 0,
      advertising: 0,
      affiliates: 0,
      adsRevenue: 0
    };
    const normalizedCategory = normalizeAnalysisText(category);
    const categoryNumberMatch = String(category || '').trim().match(/^(\d{1,2})\s*\./);
    const categoryNumber = categoryNumberMatch ? Number(categoryNumberMatch[1]) : 0;

    if (normalizedCategory === '13.faturamento bruto') {
      bucket.revenue += amount;
    } else if (normalizedCategory === '02.imposto') {
      bucket.tax += amount;
    } else if (normalizedCategory === '03.despesas marketplace') {
      bucket.marketplaceExpenses += amount;
    } else if (normalizedCategory === '14.quantidade') {
      bucket.quantity += amount;
    } else if (normalizedCategory === 'ads f') {
      bucket.adsRevenue += amount;
    } else if (categoryNumber >= 4 && categoryNumber <= 13) {
      bucket.costs += amount;
    }

    if (normalizeAnalysisText(subcategory) === 'publicidade') {
      bucket.advertising += amount;
    }
    if (normalizeAnalysisText(subcategory) === 'afiliados') {
      bucket.affiliates += amount;
    }
    if (order) {
      bucket.orders.add(order);
    }
    rawGroups.set(key, bucket);
  });

  rawGroups.forEach((raw) => {
    const metrics = createEmptyMetricBucket(raw.sku);
    metrics.revenue = raw.revenue;
    metrics.netRevenue = raw.revenue + raw.tax;
    metrics.quantity = raw.quantity;
    metrics.gm = metrics.netRevenue + raw.marketplaceExpenses + raw.costs;
    metrics.advertising = raw.advertising;
    metrics.affiliates = raw.affiliates;
    metrics.adsRevenue = raw.adsRevenue;
    metrics.channelRevenue.set(raw.marketplace, raw.revenue);
    raw.orders.forEach((value) => metrics.orders.add(value));
    if (normalizeAnalysisText(raw.ad) !== 'xx' && normalizeAnalysisText(raw.ad) !== '(vazio)') {
      metrics.ads.add(raw.ad);
    }
    addMetricBucket(total, metrics);

    [
      ['marketplaces', raw.marketplace],
      ['categories', raw.category2],
      ['skus', raw.sku],
      ['ads', raw.ad]
    ].forEach(([groupName, groupKey]) => {
      const map = groups[groupName];
      const current = map.get(groupKey) || createEmptyMetricBucket(groupKey);
      addMetricBucket(current, metrics);
      map.set(groupKey, current);
    });
  });

  const finalizeMap = (map, limit) => {
    const items = Array.from(map.values())
      .map(finalizeMetricBucket)
      .filter((item) => normalizeAnalysisText(item.name) !== 'x' && normalizeAnalysisText(item.name) !== 'xx')
      .sort((a, b) => b.revenue - a.revenue);
    return Number.isFinite(limit) ? items.slice(0, limit) : items;
  };
  const totalMetrics = finalizeMetricBucket(total);
  const analysisPools = {
    marketplaces: finalizeMap(groups.marketplaces),
    categories: finalizeMap(groups.categories),
    skus: finalizeMap(groups.skus),
    ads: finalizeMap(groups.ads)
  };
  const result = {
    month: Number(month),
    year,
    label: String(month).padStart(2, '0') + '/' + year,
    coverage: {
      latestDay,
      daysWithData: availableDays.size,
      calendarDays: new Date(year, Number(month), 0).getDate(),
      asOfDate: latestDay
        ? String(latestDay).padStart(2, '0') + '/' + String(month).padStart(2, '0') + '/' + year
        : ''
    },
    totals: totalMetrics,
    marketplaces: analysisPools.marketplaces.slice(0, 20),
    categories: analysisPools.categories.slice(0, 20),
    skus: analysisPools.skus.slice(0, 30),
    ads: analysisPools.ads.slice(0, 30)
  };
  Object.defineProperty(result, '_analysisPools', { value: analysisPools, enumerable: false });
  return result;
}

function aggregatePublishedMonth(rows, month, year) {
  const actual = aggregatePublishedScenario(rows, month, year, 'actual');
  const forecast = aggregatePublishedScenario(rows, month, year, 'forecast');
  const base = actual || forecast;

  if (!base) {
    return null;
  }

  const result = Object.assign({}, base, {
    totals: actual ? actual.totals : finalizeMetricBucket(createEmptyMetricBucket('Total')),
    marketplaces: actual ? actual.marketplaces : [],
    categories: actual ? actual.categories : [],
    skus: actual ? actual.skus : [],
    ads: actual ? actual.ads : [],
    forecastTotals: forecast ? forecast.totals : null,
    forecastMarketplaces: forecast ? forecast.marketplaces : [],
    forecastCategories: forecast ? forecast.categories : []
  });
  const poolSource = actual || forecast;
  if (poolSource && poolSource._analysisPools) {
    Object.defineProperty(result, '_analysisPools', { value: poolSource._analysisPools, enumerable: false });
  }
  return result;
}

function calculateAverageMetrics(months) {
  if (!months.length) {
    return null;
  }

  const numericKeys = [
    'revenue', 'netRevenue', 'quantity', 'averageTicket', 'gm', 'gmPercent',
    'advertising', 'affiliates', 'adsRevenue', 'tacos', 'acos', 'adsRevenueShare'
  ];
  const result = {};

  numericKeys.forEach((key) => {
    result[key] = months.reduce((total, month) => total + (Number(month.totals[key]) || 0), 0) / months.length;
  });
  return result;
}

function calculateMetricVariation(current, comparison) {
  if (!comparison) {
    return null;
  }
  if (comparison === 0) {
    return current === 0 ? 0 : null;
  }
  return (current - comparison) / Math.abs(comparison);
}

function scaleMetricTotals(totals, factor) {
  if (!totals) {
    return null;
  }
  const scaled = Object.assign({}, totals);
  ['revenue', 'netRevenue', 'quantity', 'gm', 'advertising', 'affiliates', 'adsRevenue'].forEach((key) => {
    scaled[key] = (Number(totals[key]) || 0) * factor;
  });
  scaled.orders = totals.orders ? totals.orders * factor : totals.orders;
  return scaled;
}

function scaleMetricItems(items, factor) {
  return (items || []).map((item) => Object.assign({}, item, {
    revenue: (Number(item.revenue) || 0) * factor,
    netRevenue: (Number(item.netRevenue) || 0) * factor,
    quantity: (Number(item.quantity) || 0) * factor,
    orders: item.orders ? item.orders * factor : item.orders,
    gm: (Number(item.gm) || 0) * factor,
    advertising: (Number(item.advertising) || 0) * factor,
    affiliates: (Number(item.affiliates) || 0) * factor,
    adsRevenue: (Number(item.adsRevenue) || 0) * factor
  }));
}

function hasReliableDailyHistory(month, year) {
  return year > 2026 || (year === 2026 && Number(month) >= 6);
}

function buildComparableMonth(source, reportDay) {
  const daysInMonth = new Date(source.year, Number(source.month), 0).getDate();

  if (hasReliableDailyHistory(source.month, source.year)) {
    const dailyAggregate = aggregatePublishedScenario(source.rows, source.month, source.year, 'actual', {
      cutoffDay: Math.min(reportDay, daysInMonth)
    });
    if (dailyAggregate) {
      return Object.assign({}, dailyAggregate, {
        comparisonMethod: 'daily_actual',
        comparisonDescription: 'Dados reais do mesmo número de dias'
      });
    }
  }

  const fullMonth = source.aggregate;
  const factor = Math.min(reportDay, daysInMonth) / daysInMonth;
  return Object.assign({}, fullMonth, {
    totals: scaleMetricTotals(fullMonth.totals, factor),
    marketplaces: scaleMetricItems(fullMonth.marketplaces, factor),
    categories: scaleMetricItems(fullMonth.categories, factor),
    skus: scaleMetricItems(fullMonth.skus, factor),
    ads: scaleMetricItems(fullMonth.ads, factor),
    comparisonMethod: 'estimated_daily_average',
    comparisonDescription: 'Estimativa pela média diária do mês completo',
    estimation: {
      fullMonthDays: daysInMonth,
      comparableDays: Math.min(reportDay, daysInMonth),
      factor
    }
  });
}

function addTrendVariation(currentItems, previousItems) {
  const previousMap = new Map((previousItems || []).map((item) => [normalizeAnalysisText(item.name), item]));

  return (currentItems || []).map((item) => {
    const previous = previousMap.get(normalizeAnalysisText(item.name));
    return Object.assign({}, item, {
      previousRevenue: previous ? previous.revenue : 0,
      revenueVariation: previous ? calculateMetricVariation(item.revenue, previous.revenue) : null,
      previousGm: previous ? previous.gm : 0,
      gmVariation: previous ? calculateMetricVariation(item.gm, previous.gm) : null
    });
  });
}

function buildIntelligentAbcSummary(items) {
  const ranked = (items || [])
    .filter((item) => item.revenue > 0)
    .slice()
    .sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = ranked.reduce((total, item) => total + item.revenue, 0);
  const summary = {
    totalItems: ranked.length,
    curveA: { items: 0, revenue: 0, share: 0 },
    curveB: { items: 0, revenue: 0, share: 0 },
    curveC: { items: 0, revenue: 0, share: 0 }
  };
  let accumulatedShare = 0;

  ranked.forEach((item) => {
    const share = totalRevenue === 0 ? 0 : item.revenue / totalRevenue;
    const curve = accumulatedShare < 0.8 ? 'curveA' : accumulatedShare < 0.95 ? 'curveB' : 'curveC';
    summary[curve].items += 1;
    summary[curve].revenue += item.revenue;
    accumulatedShare += share;
  });
  ['curveA', 'curveB', 'curveC'].forEach((curve) => {
    summary[curve].share = totalRevenue === 0 ? 0 : summary[curve].revenue / totalRevenue;
  });
  return summary;
}

function buildIntelligentRiskSummary(current) {
  const skus = current.skus || [];
  const ads = current.ads || [];
  const marketplaces = current.marketplaces || [];
  const categories = current.categories || [];
  const negativeMarginSkus = skus.filter((item) => item.gm < 0);
  const highTacosAds = ads.filter((item) => item.advertising > 0 && item.tacos > 0.05);
  const zeroRevenueAds = ads.filter((item) => item.advertising > 0 && item.revenue <= 0);
  const totalRevenue = current.totals.revenue || 0;
  const topMarketplace = marketplaces[0] || null;

  return {
    negativeMarginSkuCount: negativeMarginSkus.length,
    negativeMarginGm: negativeMarginSkus.reduce((total, item) => total + item.gm, 0),
    worstMarginSkus: negativeMarginSkus.slice().sort((a, b) => a.gm - b.gm).slice(0, 10),
    highTacosAdCount: highTacosAds.length,
    highTacosAdvertising: highTacosAds.reduce((total, item) => total + item.advertising, 0),
    worstTacosAds: highTacosAds.slice().sort((a, b) => b.tacos - a.tacos).slice(0, 10),
    zeroRevenueAdCount: zeroRevenueAds.length,
    topMarketplace: topMarketplace ? {
      name: topMarketplace.name,
      revenue: topMarketplace.revenue,
      share: totalRevenue === 0 ? 0 : topMarketplace.revenue / totalRevenue,
      gm: topMarketplace.gm,
      gmPercent: topMarketplace.gmPercent
    } : null,
    lowestMarginCategories: categories.slice().sort((a, b) => a.gm - b.gm).slice(0, 8)
  };
}

function buildIntelligentCoverageAudit(current) {
  const pools = current && current._analysisPools || {};
  return {
    marketplacesAnalyzed: (pools.marketplaces || current.marketplaces || []).length,
    categoriesAnalyzed: (pools.categories || current.categories || []).length,
    skusAnalyzed: (pools.skus || current.skus || []).length,
    adsAnalyzed: (pools.ads || current.ads || []).length,
    scope: 'Todos os registros agregados da base atual; listas enviadas à IA são rankings derivados desse universo.'
  };
}

function buildIntelligentDecisionViews(current) {
  const pools = current && current._analysisPools || {};
  const skus = (pools.skus || current.skus || []).slice();
  const ads = (pools.ads || current.ads || []).slice();
  const categories = (pools.categories || current.categories || []).slice();
  const byRevenue = (items) => items.slice().sort((a, b) => b.revenue - a.revenue).slice(0, 20);
  const byLowestGm = (items) => items.slice().sort((a, b) => a.gm - b.gm).slice(0, 20);
  const byAdvertising = (items) => items.slice().sort((a, b) => b.advertising - a.advertising).slice(0, 20);
  const byAcos = (items) => items.filter((item) => item.acos !== null).sort((a, b) => b.acos - a.acos).slice(0, 20);

  return {
    topRevenueSkus: byRevenue(skus),
    lowestMarginSkus: byLowestGm(skus),
    lowestMarginCategories: byLowestGm(categories),
    highestInvestmentAds: byAdvertising(ads),
    highestAcosAds: byAcos(ads)
  };
}

function buildIntelligentAnalytics() {
  const metadata = readMetadata();
  const monthEntries = Object.entries(metadata.areas.area1 && metadata.areas.area1.months || {})
    .filter((entry) => entry[1] && entry[1].rowsName)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  const fallbackYear = new Date().getFullYear();
  const monthSources = monthEntries.map(([month, monthMetadata]) => {
    const rows = readPublishedRows(monthMetadata);
    const updatedYear = monthMetadata.updatedAt ? new Date(monthMetadata.updatedAt).getFullYear() : fallbackYear;
    return {
      month,
      year: updatedYear,
      rows,
      aggregate: aggregatePublishedMonth(rows, month, updatedYear)
    };
  }).filter((source) => source.aggregate);
  const months = monthSources.map((source) => source.aggregate);

  if (!months.length) {
    return null;
  }

  const currentFull = months[months.length - 1];
  const currentSource = monthSources[monthSources.length - 1];
  const calendarDays = currentFull.coverage && currentFull.coverage.calendarDays
    || new Date(currentFull.year, currentFull.month, 0).getDate();
  const actualDataDay = Math.max(1, Math.min(
    currentFull.coverage && currentFull.coverage.daysWithData || 1,
    calendarDays
  ));
  const latestActualDay = Math.max(1, Math.min(
    currentFull.coverage && currentFull.coverage.latestDay || actualDataDay,
    calendarDays
  ));
  const mtdDay = actualDataDay;
  const currentMtd = aggregatePublishedScenario(
    currentSource.rows,
    currentSource.month,
    currentSource.year,
    'actual',
    { cutoffDay: latestActualDay }
  );
  const current = Object.assign({}, currentFull, {
    totals: currentMtd ? currentMtd.totals : currentFull.totals,
    marketplaces: currentMtd ? currentMtd.marketplaces : currentFull.marketplaces,
    categories: currentMtd ? currentMtd.categories : currentFull.categories,
    skus: currentMtd ? currentMtd.skus : currentFull.skus,
    ads: currentMtd ? currentMtd.ads : currentFull.ads
  });
  const currentPoolSource = currentMtd || currentFull;
  if (currentPoolSource && currentPoolSource._analysisPools) {
    Object.defineProperty(current, '_analysisPools', { value: currentPoolSource._analysisPools, enumerable: false });
  }
  months[months.length - 1] = current;
  const priorComparableMonths = monthSources.slice(0, -1)
    .map((source) => buildComparableMonth(source, mtdDay))
    .filter(Boolean);
  const previous = months.length > 1 ? months[months.length - 2] : null;
  const previousComparable = priorComparableMonths.length
    ? priorComparableMonths[priorComparableMonths.length - 1]
    : null;
  const average3 = calculateAverageMetrics(priorComparableMonths.slice(-3));
  const average6 = calculateAverageMetrics(priorComparableMonths.slice(-6));
  const forecastMtd = aggregatePublishedScenario(
    currentSource.rows,
    currentSource.month,
    currentSource.year,
    'forecast',
    { limitDistinctDates: actualDataDay }
  );
  const forecastToDate = forecastMtd ? forecastMtd.totals : null;
  const projectedTotals = scaleMetricTotals(current.totals, calendarDays / actualDataDay);
  const reportDateLabel = String(actualDataDay).padStart(2, '0') + '/'
    + String(current.month).padStart(2, '0') + '/' + current.year;
  const mtdDateLabel = String(mtdDay).padStart(2, '0') + '/'
    + String(current.month).padStart(2, '0') + '/' + current.year;
  const comparisons = {};

  ['revenue', 'netRevenue', 'quantity', 'averageTicket', 'gm', 'gmPercent', 'advertising', 'affiliates', 'tacos', 'acos'].forEach((key) => {
    comparisons[key] = {
      vsPrevious: calculateMetricVariation(current.totals[key], previousComparable && previousComparable.totals[key]),
      vsAverage3: calculateMetricVariation(current.totals[key], average3 && average3[key]),
      vsAverage6: calculateMetricVariation(current.totals[key], average6 && average6[key]),
      vsForecast: calculateMetricVariation(current.totals[key], forecastToDate && forecastToDate[key]),
      projectedVsForecast: calculateMetricVariation(projectedTotals && projectedTotals[key], current.forecastTotals && current.forecastTotals[key])
    };
  });

  return {
    generatedFrom: getPublishedDataSignature(),
    availableMonths: months.map((month) => month.label),
    currentMonth: current.label,
    previousMonth: previous ? previous.label : '',
    periodContext: {
      status: 'MTD Forecast',
      reportRule: 'Dias Actual carregados',
      reportDay: mtdDay,
      mtdDay,
      mtdDate: mtdDateLabel,
      actualDataDay,
      expectedD1Day: mtdDay,
      expectedD1Date: mtdDateLabel,
      dataLagDays: Math.max(mtdDay - actualDataDay, 0),
      calendarDays,
      elapsedShare: mtdDay / calendarDays,
      asOfDate: reportDateLabel,
      isPartialMonth: mtdDay < calendarDays,
      currentPeriodLabel: '01/' + String(current.month).padStart(2, '0') + '/' + current.year
        + ' a ' + reportDateLabel,
      comparisonRule: previousComparable && previousComparable.comparisonMethod === 'estimated_daily_average'
        ? 'Período anterior estimado pela média diária do mês completo'
        : 'Mesmo número de dias com dados diários reais',
      previousComparisonMethod: previousComparable && previousComparable.comparisonMethod || '',
      previousComparisonDescription: previousComparable && previousComparable.comparisonDescription || '',
      dailyHistoryAvailableFrom: '01/06/2026'
    },
    months,
    current: Object.assign({}, current, {
      marketplaces: addTrendVariation(current.marketplaces, previousComparable && previousComparable.marketplaces),
      categories: addTrendVariation(current.categories, previousComparable && previousComparable.categories),
      skus: addTrendVariation(current.skus, previousComparable && previousComparable.skus),
      ads: addTrendVariation(current.ads, previousComparable && previousComparable.ads)
    }),
    previous,
    previousComparable,
    average3,
    average6,
    forecastToDate,
    projectedTotals,
    comparisons,
    coverageAudit: buildIntelligentCoverageAudit(current),
    decisionViews: buildIntelligentDecisionViews(current),
    abc: buildIntelligentAbcSummary(current._analysisPools ? current._analysisPools.skus : current.skus),
    risks: buildIntelligentRiskSummary(Object.assign({}, current, {
      skus: current._analysisPools ? current._analysisPools.skus : current.skus,
      ads: current._analysisPools ? current._analysisPools.ads : current.ads,
      categories: current._analysisPools ? current._analysisPools.categories : current.categories,
      marketplaces: current._analysisPools ? current._analysisPools.marketplaces : current.marketplaces
    }))
  };
}

function getPublishedDataSignature() {
  const metadata = readMetadata();
  const months = Object.entries(metadata.areas.area1 && metadata.areas.area1.months || {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([month, item]) => ({
      month,
      storedName: item.storedName || '',
      rowsName: item.rowsName || '',
      updatedAt: item.updatedAt || '',
      rowsUpdatedAt: item.rowsUpdatedAt || ''
    }));

  return crypto.createHash('sha256').update(JSON.stringify({
    analysisVersion: 10,
    months
  })).digest('hex');
}

function readAiAnalysisCache() {
  if (!fs.existsSync(aiAnalysisCachePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(aiAnalysisCachePath, 'utf8')) || {};
  } catch (error) {
    console.warn('N\u00e3o foi poss\u00edvel ler o cache de an\u00e1lise IA:', error.message);
    return {};
  }
}

function writeAiAnalysisCache(cache) {
  try {
    const entries = Object.entries(cache).sort((a, b) => {
      return new Date(b[1] && b[1].generatedAt || 0) - new Date(a[1] && a[1].generatedAt || 0);
    }).slice(0, 24);
    fs.writeFileSync(aiAnalysisCachePath, JSON.stringify(Object.fromEntries(entries), null, 2));
  } catch (error) {
    console.warn('N\u00e3o foi poss\u00edvel salvar o cache de an\u00e1lise IA:', error.message);
  }
}

function getAiAnalysisCacheKey(context, model) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ version: 3, model, context }))
    .digest('hex');
}

function parseStructuredAnalysis(text) {
  try {
    const parsed = JSON.parse(text);
    const relevantPoints = Array.isArray(parsed.relevantPoints)
      ? parsed.relevantPoints.slice(0, 6).map((item, index) => ({
          title: String(item && item.title || 'Ponto relevante ' + (index + 1)),
          body: String(item && item.body || '')
        }))
      : [];

    return {
      analysis: String(parsed.analysis || '').trim(),
      relevantPoints
    };
  } catch (error) {
    return { analysis: String(text || '').trim(), relevantPoints: [] };
  }
}

function readIntelligentAnalysisCache() {
  if (intelligentAnalysisMemoryCache) {
    return intelligentAnalysisMemoryCache;
  }

  for (const cachePath of [intelligentAnalysisCachePath, intelligentAnalysisFallbackCachePath]) {
    if (!fs.existsSync(cachePath)) {
      continue;
    }
    try {
      intelligentAnalysisMemoryCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      return intelligentAnalysisMemoryCache;
    } catch (error) {
      console.warn('Nao foi possivel ler o cache da Analise Inteligente:', error.message);
    }
  }
  return null;
}

function writeIntelligentAnalysisCache(result) {
  const payload = JSON.stringify(result);
  intelligentAnalysisMemoryCache = result;

  try {
    fs.writeFileSync(intelligentAnalysisCachePath, payload);
    return;
  } catch (error) {
    console.warn('Drive indisponivel para o cache da Analise Inteligente; usando cache alternativo:', error.message);
  }

  try {
    fs.writeFileSync(intelligentAnalysisFallbackCachePath, payload);
  } catch (error) {
    console.warn('Nao foi possivel persistir o cache alternativo da Analise Inteligente:', error.message);
  }
}

function removeForecastComparisons(comparisons) {
  if (!comparisons || typeof comparisons !== 'object') {
    return comparisons;
  }
  return Object.fromEntries(Object.entries(comparisons).map(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return [key, value];
    }
    const copy = Object.assign({}, value);
    delete copy.vsForecast;
    delete copy.projectedVsForecast;
    return [key, copy];
  }));
}

function compactIntelligentAnalytics(analytics, options) {
  const includeFullBase = Boolean(options && options.includeFullBase);
  const dailyMode = Boolean(options && options.dailyMode);
  const actualOnly = Boolean(options && options.actualOnly);
  const compactMetric = (item) => ({
    name: item.name,
    revenue: item.revenue,
    netRevenue: item.netRevenue,
    quantity: item.quantity,
    orders: item.orders,
    averageTicket: item.averageTicket,
    gm: item.gm,
    gmPercent: item.gmPercent,
    advertising: item.advertising,
    affiliates: item.affiliates,
    adsRevenue: item.adsRevenue,
    tacos: item.tacos,
    acos: item.acos,
    adsRevenueShare: item.adsRevenueShare,
    channels: item.channels,
    revenueVariation: item.revenueVariation,
    gmVariation: item.gmVariation
  });
  const listMetrics = (items) => (Array.isArray(items) ? items : []).map(compactMetric);
  const poolItems = (source, key) => source && source._analysisPools && Array.isArray(source._analysisPools[key])
    ? source._analysisPools[key]
    : (source && Array.isArray(source[key]) ? source[key] : []);
  const result = {
    availableMonths: analytics.availableMonths,
    currentMonth: analytics.currentMonth,
    previousMonth: analytics.previousMonth,
    periodContext: analytics.periodContext,
    monthlyEvolution: analytics.months.map((month) => ({
      month: month.label,
      totals: month.totals,
      marketplaces: month.marketplaces.map(compactMetric)
    })),
    currentTotals: analytics.current.totals,
    forecastTotals: actualOnly ? null : analytics.current.forecastTotals,
    forecastToDate: actualOnly ? null : analytics.forecastToDate,
    projectedClosing: actualOnly ? null : analytics.projectedTotals,
    previousTotals: analytics.previous && analytics.previous.totals,
    previousComparableTotals: analytics.previousComparable && analytics.previousComparable.totals,
    average3: analytics.average3,
    average6: analytics.average6,
    comparisons: actualOnly ? removeForecastComparisons(analytics.comparisons) : analytics.comparisons,
    coverageAudit: analytics.coverageAudit,
    decisionViews: analytics.decisionViews,
    marketplaces: analytics.current.marketplaces.map(compactMetric),
    categories: analytics.current.categories.map(compactMetric),
    skus: analytics.current.skus.map(compactMetric),
    ads: analytics.current.ads.map(compactMetric),
    goals: actualOnly ? null : {
      source: 'Forecast da base carregada',
      totals: analytics.current.forecastTotals,
      marketplaces: analytics.current.forecastMarketplaces.map(compactMetric),
      categories: analytics.current.forecastCategories.map(compactMetric)
    },
    abc: analytics.abc,
    risks: analytics.risks
  };

  if (includeFullBase) {
    const currentPools = {
      marketplaces: poolItems(analytics.current, 'marketplaces'),
      categories: poolItems(analytics.current, 'categories'),
      skus: poolItems(analytics.current, 'skus'),
      ads: poolItems(analytics.current, 'ads')
    };
    const monthFull = (month) => ({
      month: month.label,
      coverage: month.coverage,
      totals: month.totals,
      marketplaces: listMetrics(poolItems(month, 'marketplaces')),
      categories: listMetrics(poolItems(month, 'categories')),
      skus: dailyMode ? [] : listMetrics(poolItems(month, 'skus')).slice(0, 80),
      ads: dailyMode ? [] : listMetrics(poolItems(month, 'ads')).slice(0, 120)
    });
    const catalogFromMonths = (key) => Array.from(new Set(analytics.months.flatMap((month) => poolItems(month, key).map((item) => item.name)))).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

    result.completeBase = {
      scope: dailyMode
        ? 'Base de apoio agregada. Como a pergunta contém dias específicos, o recorte diário completo está em dailyData e deve ser usado como fonte prioritária sem cortes.'
        : 'Base completa agregada a partir dos arquivos publicados: todos os registros foram consolidados por mês, Marketplace, Categoria2, SKU e Anúncio. O contexto não envia cada linha bruta para evitar estouro de tokens; envia agregados calculados do universo disponível e usa targetedData para recortes específicos.',
      currentPeriod: {
        month: analytics.current.label,
        coverage: analytics.current.coverage,
        totals: analytics.current.totals,
        marketplaces: listMetrics(currentPools.marketplaces),
        categories: listMetrics(currentPools.categories),
        skus: dailyMode ? listMetrics(currentPools.skus).slice(0, 80) : listMetrics(currentPools.skus),
        ads: dailyMode ? listMetrics(currentPools.ads).slice(0, 120) : listMetrics(currentPools.ads)
      },
      allMonths: analytics.months.map(monthFull),
      catalog: dailyMode ? {
        marketplaces: catalogFromMonths('marketplaces'),
        categories: catalogFromMonths('categories')
      } : {
        marketplaces: catalogFromMonths('marketplaces'),
        categories: catalogFromMonths('categories'),
        skus: catalogFromMonths('skus'),
        ads: catalogFromMonths('ads')
      },
      counts: {
        months: analytics.months.length,
        currentMarketplaces: currentPools.marketplaces.length,
        currentCategories: currentPools.categories.length,
        currentSkus: currentPools.skus.length,
        currentAds: currentPools.ads.length,
        catalogMarketplaces: catalogFromMonths('marketplaces').length,
        catalogCategories: catalogFromMonths('categories').length,
        catalogSkus: dailyMode ? 0 : catalogFromMonths('skus').length,
        catalogAds: dailyMode ? 0 : catalogFromMonths('ads').length
      }
    };
  }

  return result;
}

function sanitizeCopilotMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  const recent = messages.slice(-12);
  return recent.map((message, index) => {
    const role = message && message.role === 'assistant' ? 'assistant' : 'user';
    const text = String(message && message.text || '').trim().slice(0, 5000);
    const image = index === recent.length - 1 && role === 'user' && typeof message.image === 'string'
      && /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(message.image)
      && message.image.length <= 6 * 1024 * 1024
      ? message.image
      : '';

    return { role, text, image };
  }).filter((message) => message.text || message.image);
}

function getPublishedAnalysisSources() {
  const metadata = readMetadata();
  return Object.entries(metadata.areas.area1 && metadata.areas.area1.months || {})
    .filter(([, item]) => item && item.rowsName)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([month, monthMetadata]) => {
      const year = monthMetadata.updatedAt
        ? new Date(monthMetadata.updatedAt).getFullYear()
        : getSaoPauloDateParts().year;
      return {
        month: Number(month),
        year,
        rows: readPublishedRows(monthMetadata),
        rowsName: monthMetadata.rowsName,
        updatedAt: monthMetadata.rowsUpdatedAt || monthMetadata.updatedAt || ''
      };
    })
    .filter((source) => Array.isArray(source.rows) && source.rows.length > 1);
}

function getLatestPublishedAnalysisSource() {
  const sources = getPublishedAnalysisSources();
  return sources[sources.length - 1] || null;
}

function extractCopilotSearchTerms(messages) {
  const recentUserMessages = (messages || []).filter((message) => message && message.role === 'user').slice(-4);
  const text = recentUserMessages.map((message) => String(message.text || '')).join('\n');
  const stopWords = new Set([
    'sobre', 'qual', 'quais', 'como', 'porque', 'por', 'que', 'onde', 'este', 'esta', 'esse', 'essa',
    'produto', 'produtos', 'anuncio', 'anuncios', 'marketplace', 'categoria', 'conta', 'canal',
    'faturamento', 'margem', 'publicidade', 'investimento', 'analise', 'analisar', 'dados', 'resultado',
    'comparar', 'comparativo', 'cresceu', 'crescimento', 'queda', 'quedas', 'maiores', 'menores'
  ]);

  return Array.from(new Set(text.split(/[^A-Za-zÀ-ÿ0-9_-]+/)
    .map((term) => normalizeAnalysisText(term))
    .filter((term) => term.length >= 3 && !stopWords.has(term))));
}

function buildCopilotTargetedContext(messages, options) {
  const sources = getPublishedAnalysisSources();
  const terms = extractCopilotSearchTerms(messages);

  if (!sources.length || !terms.length) {
    return null;
  }

  const identifierTerms = terms.filter((term) => /\d/.test(term) || term.length >= 8);
  const effectiveTerms = identifierTerms.length ? identifierTerms : terms;
  const periods = [];
  const globalDimensions = new Map();
  let totalMatchedRows = 0;

  sources.forEach((source) => {
    const headers = source.rows[0].map((header) => String(header || ''));
    const searchableColumns = [
      ['Marketplace'], ['Marketplace venda'], ['SKU'],
      ['Id anuncio', 'Id anúncio', 'ID do anuncio', 'Anúncio'],
      ['Categoria'], ['Categoria2', 'Categoria 2'],
      ['Sub Categoria', 'Subcategoria', 'Sub-Categoria'],
      ['Descrição', 'Descricao'], ['Type']
    ].map((names) => findAnalysisHeader(headers, names)).filter((index) => index >= 0);
    const matchedRows = source.rows.slice(1).filter((row) => {
      const searchableText = searchableColumns
        .map((index) => normalizeAnalysisText(row[index]))
        .join(' | ');
      return identifierTerms.length
        ? effectiveTerms.every((term) => searchableText.includes(term))
        : effectiveTerms.some((term) => searchableText.includes(term));
    });

    if (!matchedRows.length) {
      return;
    }

    totalMatchedRows += matchedRows.length;
    const today = getSaoPauloDateParts();
    const cutoffDay = source.month === today.month && source.year === today.year
      ? Math.max(today.day - 1, 1)
      : new Date(source.year, source.month, 0).getDate();
    const matchedDataset = [headers].concat(matchedRows);
    const actual = aggregatePublishedScenario(matchedDataset, source.month, source.year, 'actual', { cutoffDay });
    const forecast = options && options.actualOnly ? null : aggregatePublishedScenario(matchedDataset, source.month, source.year, 'forecast');
    const dimensions = {};

    searchableColumns.forEach((index) => {
      const name = headers[index];
      const values = Array.from(new Set(matchedRows.map((row) => String(row[index] || '').trim()).filter(Boolean))).slice(0, 100);
      dimensions[name] = values;
      const globalSet = globalDimensions.get(name) || new Set();
      values.forEach((value) => globalSet.add(value));
      globalDimensions.set(name, globalSet);
    });

    periods.push({
      period: String(source.month).padStart(2, '0') + '/' + source.year,
      rowsName: source.rowsName,
      updatedAt: source.updatedAt,
      matchedRows: matchedRows.length,
      dimensions,
      actual,
      forecast
    });
  });

  if (!periods.length) {
    return {
      queryTerms: effectiveTerms,
      matchedRows: 0,
      searchedMonths: sources.map((source) => String(source.month).padStart(2, '0') + '/' + source.year),
      note: 'Nenhum registro específico da base correspondeu aos termos pesquisados; use completeBase para responder análises gerais e explique se o identificador citado não existir no catálogo.'
    };
  }

  return {
    queryTerms: effectiveTerms,
    matchedRows: totalMatchedRows,
    searchedMonths: sources.map((source) => String(source.month).padStart(2, '0') + '/' + source.year),
    dimensions: Object.fromEntries(Array.from(globalDimensions.entries()).map(([name, values]) => [name, Array.from(values).slice(0, 200)])),
    periods
  };
}

function toAnalysisIsoDate(parts) {
  if (!parts || !parts.day || !parts.month || !parts.year) {
    return '';
  }
  return String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
}

function getCopilotLatestSourceForDateFallback(sources) {
  return sources[sources.length - 1] || { month: getSaoPauloDateParts().month, year: getSaoPauloDateParts().year };
}

function extractCopilotRequestedDates(messages) {
  const recentUserMessages = (messages || []).filter((message) => message && message.role === 'user').slice(-4);
  const text = recentUserMessages.map((message) => String(message.text || '')).join('\n');
  const normalized = normalizeAnalysisText(text);
  const sources = getPublishedAnalysisSources();
  const fallback = getCopilotLatestSourceForDateFallback(sources);
  const dates = new Map();
  const explicitDates = [];
  const buildDate = (day, month, year, sourceText, index) => {
    const safeDay = Number(day);
    const safeMonth = Number(month) || Number(fallback.month);
    const safeYear = Number(year) ? (Number(year) < 100 ? 2000 + Number(year) : Number(year)) : Number(fallback.year);
    if (!safeDay || safeDay < 1 || safeDay > 31 || !safeMonth || safeMonth < 1 || safeMonth > 12 || !safeYear) {
      return null;
    }
    const date = new Date(safeYear, safeMonth - 1, safeDay);
    if (date.getFullYear() !== safeYear || date.getMonth() !== safeMonth - 1 || date.getDate() !== safeDay) {
      return null;
    }
    const iso = toAnalysisIsoDate({ day: safeDay, month: safeMonth, year: safeYear });
    return iso ? { iso, day: safeDay, month: safeMonth, year: safeYear, sourceText, index: Number(index) || 0 } : null;
  };
  const addDate = (date) => {
    if (date) {
      dates.set(date.iso, date);
    }
  };
  const addRange = (startDate, endDate, sourceText) => {
    if (!startDate || !endDate) {
      return;
    }
    const startTime = new Date(startDate.year, startDate.month - 1, startDate.day).getTime();
    const endTime = new Date(endDate.year, endDate.month - 1, endDate.day).getTime();
    const step = startTime <= endTime ? 86400000 : -86400000;
    const length = Math.floor(Math.abs(endTime - startTime) / 86400000) + 1;
    if (length > 45) {
      addDate(startDate);
      addDate(endDate);
      return;
    }
    for (let time = startTime, count = 0; count < length; time += step, count += 1) {
      const date = new Date(time);
      addDate({
        iso: toAnalysisIsoDate({ day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() }),
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
        sourceText
      });
    }
  };

  Array.from(text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)).forEach((match) => {
    const date = buildDate(match[3], match[2], match[1], match[0], match.index);
    addDate(date);
    if (date) explicitDates.push(Object.assign({}, date, { endIndex: match.index + match[0].length }));
  });
  Array.from(text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/g)).forEach((match) => {
    const date = buildDate(match[1], match[2], match[3] || fallback.year, match[0], match.index);
    addDate(date);
    if (date) explicitDates.push(Object.assign({}, date, { endIndex: match.index + match[0].length }));
  });
  Array.from(normalized.matchAll(/\bdia\s+(\d{1,2})\b/g)).forEach((match) => {
    addDate(buildDate(match[1], fallback.month, fallback.year, match[0], match.index));
  });

  explicitDates.sort((a, b) => a.index - b.index);
  for (let index = 0; index < explicitDates.length - 1; index += 1) {
    const current = explicitDates[index];
    const next = explicitDates[index + 1];
    const between = normalizeAnalysisText(text.slice(current.endIndex, next.index));
    if (/^(?:\s)*(?:a|ate|até|ao|ate o dia|até o dia|e ate|e até)(?:\s)*$/.test(between)) {
      addRange(current, next, current.sourceText + ' a ' + next.sourceText);
    }
  }

  return Array.from(dates.values()).sort((a, b) => a.iso.localeCompare(b.iso)).slice(0, 45);
}

function compactCopilotDailyScenario(scenario, options) {
  if (!scenario) {
    return null;
  }
  const compact = (item) => ({
    name: item.name,
    revenue: item.revenue,
    netRevenue: item.netRevenue,
    quantity: item.quantity,
    orders: item.orders,
    averageTicket: item.averageTicket,
    gm: item.gm,
    gmPercent: item.gmPercent,
    advertising: item.advertising,
    affiliates: item.affiliates,
    adsRevenue: item.adsRevenue,
    tacos: item.tacos,
    acos: item.acos,
    adsRevenueShare: item.adsRevenueShare,
    channels: item.channels
  });
  const pools = scenario._analysisPools || {};
  const summaryOnly = Boolean(options && options.summaryOnly);
  return {
    coverage: scenario.coverage,
    totals: scenario.totals,
    marketplaces: (pools.marketplaces || scenario.marketplaces || []).map(compact),
    categories: (pools.categories || scenario.categories || []).map(compact),
    skus: summaryOnly ? [] : (pools.skus || scenario.skus || []).map(compact),
    ads: summaryOnly ? [] : (pools.ads || scenario.ads || []).map(compact)
  };
}

function buildCopilotNegativeMarginSummary(actualScenario) {
  if (!actualScenario) {
    return null;
  }
  const summarize = (items) => {
    const negatives = (items || []).filter((item) => Number(item.gm) < 0);
    return {
      count: negatives.length,
      gm: negatives.reduce((total, item) => total + (Number(item.gm) || 0), 0),
      revenue: negatives.reduce((total, item) => total + (Number(item.revenue) || 0), 0),
      items: negatives.slice().sort((a, b) => (Number(a.gm) || 0) - (Number(b.gm) || 0)).slice(0, 25)
    };
  };
  return {
    source: 'Soma de GM negativa calculada no servidor com todos os agregados do recorte. A soma usa GM < 0.',
    byCategory: summarize(actualScenario.categories),
    bySku: summarize(actualScenario.skus),
    byAd: summarize(actualScenario.ads)
  };
}

function calculateCopilotDailyComparisons(days) {
  if (!Array.isArray(days) || days.length < 2) {
    return null;
  }
  const [first, second] = days;
  const firstTotals = first.actual && first.actual.totals || {};
  const secondTotals = second.actual && second.actual.totals || {};
  const keys = ['revenue', 'netRevenue', 'quantity', 'averageTicket', 'gm', 'gmPercent', 'advertising', 'affiliates', 'tacos', 'acos'];
  const totals = {};
  keys.forEach((key) => {
    totals[key] = {
      first: firstTotals[key],
      second: secondTotals[key],
      variation: (Number(firstTotals[key]) || 0) - (Number(secondTotals[key]) || 0),
      variationPercent: calculateMetricVariation(Number(firstTotals[key]) || 0, Number(secondTotals[key]) || 0)
    };
  });
  return {
    base: first.date,
    comparedWith: second.date,
    totals
  };
}

function buildCopilotDailyContext(messages) {
  const requestedDates = extractCopilotRequestedDates(messages);
  if (!requestedDates.length) {
    return null;
  }

  const sources = getPublishedAnalysisSources();
  const isRange = requestedDates.length > 2;
  const combinedByPeriod = new Map();
  const days = requestedDates.map((requestedDate) => {
    const source = sources.find((item) => Number(item.month) === Number(requestedDate.month) && Number(item.year) === Number(requestedDate.year));
    if (!source) {
      return {
        date: requestedDate.iso,
        requestedAs: requestedDate.sourceText,
        matchedRows: 0,
        note: 'Nenhum arquivo publicado encontrado para este mês/ano.'
      };
    }

    const headers = source.rows[0].map((header) => String(header || ''));
    const dateIndex = findAnalysisHeader(headers, ['Data', 'Full Data', 'Record Date']);
    if (dateIndex < 0) {
      return {
        date: requestedDate.iso,
        requestedAs: requestedDate.sourceText,
        matchedRows: 0,
        note: 'A base publicada não possui coluna de data reconhecida.'
      };
    }

    const dateRows = source.rows.slice(1).filter((row) => {
      const parts = parseAnalysisDateParts(row[dateIndex], source.month, source.year);
      return toAnalysisIsoDate(parts) === requestedDate.iso;
    });
    const periodKey = String(source.month).padStart(2, '0') + '/' + source.year;
    const periodBucket = combinedByPeriod.get(periodKey) || { source, headers, rows: [] };
    periodBucket.rows = periodBucket.rows.concat(dateRows);
    combinedByPeriod.set(periodKey, periodBucket);
    const dataset = [headers].concat(dateRows);

    return {
      date: requestedDate.iso,
      label: String(requestedDate.day).padStart(2, '0') + '/' + String(requestedDate.month).padStart(2, '0') + '/' + requestedDate.year,
      requestedAs: requestedDate.sourceText,
      period: periodKey,
      rowsName: source.rowsName,
      updatedAt: source.updatedAt,
      matchedRows: dateRows.length,
      actual: compactCopilotDailyScenario(aggregatePublishedScenario(dataset, source.month, source.year, 'actual'), { summaryOnly: isRange }),
      forecast: null
    };
  });

  const periodAggregates = Array.from(combinedByPeriod.entries()).map(([period, bucket]) => {
    const dataset = [bucket.headers].concat(bucket.rows);
    const actual = compactCopilotDailyScenario(aggregatePublishedScenario(dataset, bucket.source.month, bucket.source.year, 'actual'));
    const forecast = null;
    return {
      period,
      dates: requestedDates.filter((date) => String(date.month).padStart(2, '0') + '/' + date.year === period).map((date) => date.iso),
      matchedRows: bucket.rows.length,
      actual,
      forecast,
      negativeMarginSummary: buildCopilotNegativeMarginSummary(actual)
    };
  });

  return {
    scope: isRange
      ? 'Recorte de intervalo diário solicitado. days traz totais, Marketplace e Categoria2 por dia; periodAggregates traz o período consolidado com todos os SKUs e anúncios, sem corte, para cálculos minuciosos do intervalo.'
      : 'Recorte diário exato solicitado pelo usuário. Cada dia inclui todas as linhas da base para a data, agregadas por totais, Marketplace, Categoria2, SKU e Anúncio, sem cortes de top ranking.',
    requestedDates: requestedDates.map((item) => item.iso),
    days,
    periodAggregates,
    comparison: calculateCopilotDailyComparisons(days.filter((day) => day.actual && day.actual.totals))
  };
}

function buildCopilotActualDailyIndex() {
  const sources = getPublishedAnalysisSources();
  return sources.map((source) => {
    const headers = source.rows[0].map((header) => String(header || ''));
    const dateIndex = findAnalysisHeader(headers, ['Data', 'Full Data', 'Record Date']);
    const scenarioIndex = findAnalysisHeader(headers, ['Datatype', 'Data Type', 'Tipo de dado', 'Tipo dados']);
    if (dateIndex < 0) {
      return null;
    }
    const dateBuckets = new Map();
    source.rows.slice(1).forEach((row) => {
      const scenario = scenarioIndex >= 0 ? row[scenarioIndex] : 'actual';
      if (!isActualAnalysisValue(scenario)) {
        return;
      }
      const parts = parseAnalysisDateParts(row[dateIndex], source.month, source.year);
      const iso = toAnalysisIsoDate(parts);
      if (!iso) {
        return;
      }
      const bucket = dateBuckets.get(iso) || [];
      bucket.push(row);
      dateBuckets.set(iso, bucket);
    });
    const days = Array.from(dateBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([iso, rows]) => {
      const aggregate = aggregatePublishedScenario([headers].concat(rows), source.month, source.year, 'actual');
      return {
        date: iso,
        rows: rows.length,
        totals: aggregate && aggregate.totals || null,
        marketplaces: aggregate ? aggregate.marketplaces : [],
        categories: aggregate ? aggregate.categories : []
      };
    });
    return {
      period: String(source.month).padStart(2, '0') + '/' + source.year,
      rowsName: source.rowsName,
      actualDays: days.map((day) => day.date),
      days
    };
  }).filter(Boolean);
}

function getCopilotConversationContext(messages) {
  const userMessages = (messages || []).filter((message) => message && message.role === 'user');
  const latest = userMessages[userMessages.length - 1] || {};
  const requestedDates = extractCopilotRequestedDates(messages).map((date) => date.iso);
  const latestText = normalizeAnalysisText(latest.text || '');
  let requestedBreakdown = '';
  if (/\bsku\b/.test(latestText)) requestedBreakdown = 'SKU';
  else if (/\banuncio\b|\banuncios\b|\bads?\b/.test(latestText)) requestedBreakdown = 'Anúncio';
  else if (/categoria|categoria2/.test(latestText)) requestedBreakdown = 'Categoria2';
  else if (/marketplace|canal/.test(latestText)) requestedBreakdown = 'Marketplace';
  return {
    latestUserText: String(latest.text || '').slice(0, 500),
    recentUserTexts: userMessages.slice(-4).map((message) => String(message.text || '').slice(0, 500)),
    carriedDates: requestedDates,
    requestedBreakdown,
    isFollowUp: userMessages.length > 1 && requestedBreakdown && !/\d{1,2}[/.\-]\d{1,2}/.test(String(latest.text || ''))
  };
}

function buildCopilotContext(messages) {
  const analytics = buildIntelligentAnalytics();
  const intelligentCache = readIntelligentAnalysisCache();

  if (!analytics) {
    return null;
  }

  const dailyData = buildCopilotDailyContext(messages);
  const conversationContext = getCopilotConversationContext(messages);

  return {
    generatedFrom: analytics.generatedFrom,
    businessData: compactIntelligentAnalytics(analytics, { includeFullBase: true, dailyMode: Boolean(dailyData), actualOnly: true }),
    latestAiAnalysis: null,
    targetedData: dailyData ? null : buildCopilotTargetedContext(messages, { actualOnly: true }),
    dailyData,
    conversationContext,
    actualDailyIndex: buildCopilotActualDailyIndex()
  };
}

function buildCopilotInput(messages) {
  return messages.map((message) => {
    if (message.image) {
      return {
        role: message.role,
        content: [
          { type: 'input_text', text: message.text || 'Analise esta imagem de anúncio considerando o contexto financeiro da empresa.' },
          { type: 'input_image', image_url: message.image }
        ]
      };
    }

    return {
      role: message.role,
      content: message.text
    };
  });
}

async function handleCopilotChat(request, response) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const clientIp = request.socket.remoteAddress || 'unknown';
  const lastRun = copilotLastRunByIp.get(clientIp) || 0;

  if (!apiKey) {
    sendJson(response, 500, { error: 'OPENAI_API_KEY não configurada no servidor.' });
    request.resume();
    return;
  }

  if (Date.now() - lastRun < 1200) {
    sendJson(response, 429, { error: 'Aguarde um instante antes de enviar outra pergunta.' });
    request.resume();
    return;
  }

  copilotLastRunByIp.set(clientIp, Date.now());

  try {
    const payload = await collectJsonRequest(request, maxCopilotRequestBytes);
    const messages = sanitizeCopilotMessages(payload.messages);
    const context = buildCopilotContext(messages);
    const pageContext = payload.pageContext && typeof payload.pageContext === 'object'
      ? {
        page: String(payload.pageContext.page || '').slice(0, 80),
        month: String(payload.pageContext.month || '').slice(0, 30),
        periodStart: String(payload.pageContext.periodStart || '').slice(0, 20),
        periodEnd: String(payload.pageContext.periodEnd || '').slice(0, 20),
        filters: payload.pageContext.filters && typeof payload.pageContext.filters === 'object'
          ? payload.pageContext.filters
          : {}
      }
      : {};

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      sendJson(response, 400, { error: 'Envie uma pergunta para o Copiloto FP&A.' });
      return;
    }

    if (!context) {
      sendJson(response, 400, { error: 'Nenhuma base processada está disponível para análise.' });
      return;
    }

    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions: [
          'Você é o Copiloto FP&A da empresa, um assistente especializado em controladoria, finanças, e-commerce, marketplaces, publicidade, precificação e crescimento.',
          'Responda sempre em português do Brasil, com linguagem profissional, clara, direta e fácil de compreender.',
          'Use exclusivamente os dados Actual/realizados fornecidos no contexto. O campo businessData.completeBase contém apenas a base Actual agregada disponível; consulte esse campo antes de concluir que não há informação. Nunca invente números, causas, metas, estoque, conversão ou informações indisponíveis.',
          'Considere que o mês atual é parcial e que o MTD Forecast soma os mesmos dias alimentados no Actual. Não trate o mês como encerrado.',
          'Todas as análises do Copiloto devem usar exclusivamente dados Actual/realizados. Não use Forecast, metas, orçamento, projeção ou MTD Forecast estimado para responder análises, exceto se o usuário pedir explicitamente Forecast.',
          'O contexto actualDailyIndex contém todos os dias carregados em Actual. Use esse índice para saber quais datas existem, analisar tendências diárias e evitar dizer que não há dados quando a data está listada ali.',
          'Quando a pergunta for sobre queda, crescimento ou eficiência, apresente números e comparações que sustentem a conclusão.',
          'Não traga recomendações de ação na primeira resposta. Só apresente recomendações se o usuário pedir explicitamente ou escolher essa opção no aprofundamento.',
          'Para produtos, categorias, marketplaces ou anúncios, cite os nomes, SKUs e IDs presentes nos dados.',
          'Para publicidade, use os campos reais: Publicidade como investimento, ADS F como faturamento atribuído, ACOS como Publicidade dividido por ADS F e TACOS como Publicidade dividido por Faturamento Bruto.',
          'Considere também o investimento em Afiliados separado da Publicidade.',
          'Não use ROAS nem MOAS nas conclusões, pois esses indicadores foram removidos desta análise. Nunca escreva a palavra ROAS; para publicidade use apenas ACOS, TACOS, investimento e faturamento ADS F.',
          'Não invente percentuais de aumento de verba, limites de pausa ou metas. Só proponha números quando puder calculá-los com os dados fornecidos; caso contrário, recomende um teste controlado sem fixar percentual.',
          'Quando targetedData estiver preenchido, ele é o recorte prioritário e exato da base para o SKU, anúncio, conta, canal ou categoria citado pelo usuário.',
          'Cruze o recorte específico com histórico realizado, Curva ABC e demais agregados Actual antes de concluir.',
          'Para imagens de anúncios, avalie qualidade visual, clareza, hierarquia, diferenciais, potencial de conversão e melhorias; não afirme atributos que não estejam visíveis.',
          'Antes de dizer que não possui dados, verifique businessData.completeBase, businessData.decisionViews, businessData.risks, monthlyEvolution, targetedData e dailyData. Só informe falta de dados quando o recorte Actual realmente não contiver a dimensão ou métrica pedida; nesse caso diga exatamente o que falta.',
          'Quando dailyData estiver preenchido, a pergunta envolve dias específicos. Use dailyData como recorte prioritário de Actual dia contra dia, preservando todos os agregados realizados daquele dia.',
          'Use conversationContext para continuar a análise da sessão. Se a última mensagem for apenas um aprofundamento como Por SKU, Por Anúncio, Por Categoria2 ou Por Marketplace, mantenha as datas e o assunto das mensagens anteriores.',
          'Se não houver Actual para uma data solicitada, não substitua por Forecast. Diga: não há Actual carregado para essa data, e informe quais datas com Actual estão disponíveis no recorte.',
          'Se o usuário pedir aprofundamento curto, como Por SKU, Por Anúncio ou Por Categoria, mantenha o período da conversa anterior e use o recorte diário já reconstruído. Não diga que faltam dados se dailyData.periodAggregates trouxer skus, ads ou categories.',
          'Quando dailyData.periodAggregates[].actual.skus existir, há breakdown por SKU no período. Use esses SKUs para listar maiores reduções de GM ou margens negativas.',
          'Se o usuário informar um intervalo explícito de datas, assuma exatamente esse intervalo e responda direto. Não pergunte se é MTD Forecast, mês completo ou outro recorte. Só faça pergunta se não houver nenhuma data ou dimensão suficiente para calcular.',
          'Para perguntas de soma, total, margem negativa, faturamento, GM, publicidade ou quantidade em datas explícitas, calcule somente com Actual em dailyData.periodAggregates quando existir e apresente o valor primeiro.',
          'Se a pergunta pedir soma da margem negativa, use dailyData.periodAggregates[].negativeMarginSummary. Responda direto a soma de GM negativa por SKU como padrão; não pergunte se o usuário quer soma ou lista. Depois ofereça aprofundamento por SKU, Categoria2 ou Anúncio.',
          'Não cite nomes técnicos internos como dailyData, periodAggregates, completeBase, targetedData ou JSON. Diga apenas que o cálculo veio do recorte diário da base.',
          'Formato obrigatório: resposta curta, objetiva e sem repetição. Comece com o número principal em uma frase.',
          'Depois mostre apenas a composição mais relevante em bullets. Cada bullet deve ficar em uma nova linha começando com hífen. Não escreva a palavra item; use, por exemplo: - GA953: R$ -78,58.',
          'Não repita o mesmo número, causa ou conclusão em mais de um bloco. Se uma informação já apareceu no número principal, não reexplique em outro parágrafo.',
          'Escolha no máximo 1 dimensão principal para detalhar por padrão: SKU para margem negativa, Marketplace para canal, Anúncio para publicidade, Categoria2 para mix. Só adicione outra dimensão se ela trouxer uma causa diferente.',
          'Limite listas a no máximo 8 itens. Se houver mais itens, diga Outros: R$ X,XX.',
          'Use no máximo 4 blocos: Resposta, Composição, Observação curta e Quer aprofundar?.',
          'No final, ofereça uma enquete curta com 2 ou 3 opções de aprofundamento, podendo incluir Recomendações como uma das opções. Não traga recomendações antes do usuário escolher.',
          'Evite respostas genéricas, jargões desnecessários, recomendações iniciais e parágrafos longos.',
          'A tela e o período que o usuário está visualizando são: ' + JSON.stringify(pageContext) + '. Use isso apenas como contexto de navegação; os números devem vir do contexto consolidado.',
          'Contexto consolidado da empresa: ' + JSON.stringify(context)
        ].join(' '),
        input: buildCopilotInput(messages),
        reasoning: { effort: 'low' },
        max_output_tokens: 1800
      })
    });
    const result = await openAiResponse.json().catch(() => ({}));

    if (!openAiResponse.ok) {
      const message = result.error && result.error.message
        ? result.error.message
        : 'Não foi possível consultar o Copiloto FP&A.';
      sendJson(response, openAiResponse.status, { error: message });
      return;
    }

    const answer = extractResponseText(result);
    if (!answer) {
      sendJson(response, 502, { error: 'O Copiloto não retornou uma resposta. Tente novamente.' });
      return;
    }

    sendJson(response, 200, {
      answer: cleanAiBusinessText(answer),
      model,
      generatedAt: new Date().toISOString(),
      signature: context.generatedFrom
    });
  } catch (error) {
    const statusCode = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    const message = error.message === 'PAYLOAD_TOO_LARGE'
      ? 'A conversa ou imagem enviada excede o limite permitido.'
      : error.message === 'INVALID_JSON'
        ? 'A solicitação enviada é inválida.'
        : 'Erro ao consultar o Copiloto FP&A: ' + error.message;

    console.error('Erro no Copiloto FP&A:', error);
    sendJson(response, statusCode, { error: message });
  }
}

function parseIntelligentStructuredAnalysis(text) {
  try {
    const parsed = JSON.parse(text);
    const mapItems = (items, limit) => (Array.isArray(items) ? items : []).slice(0, limit).map((item) => ({
      title: cleanAiBusinessText(item && item.title),
      evidence: cleanAiBusinessText(item && item.evidence),
      diagnosis: cleanAiBusinessText(item && item.diagnosis),
      action: cleanAiBusinessText(item && item.action)
    }));

    return {
      executiveSummary: cleanAiBusinessText(parsed.executiveSummary),
      businessNarrative: cleanAiBusinessText(parsed.businessNarrative),
      financialDiagnosis: cleanAiBusinessText(parsed.financialDiagnosis),
      kpiAssessment: cleanAiBusinessText(parsed.kpiAssessment),
      trends: mapItems(parsed.trends, 4),
      alerts: mapItems(parsed.alerts, 4),
      recommendations: mapItems(parsed.recommendations, 5)
    };
  } catch (error) {
    return null;
  }
}

function cleanAiBusinessText(value) {
  return String(value || '')
    .replace(/\bforecastToDate\b/gi, 'Forecast proporcional ao MTD Forecast')
    .replace(/\bactualDataDay\s*=\s*(\d+)/gi, 'dados realizados até o dia $1')
    .replace(/\bmtdDay\s*=\s*(\d+)/gi, 'MTD Forecast D-$1')
    .replace(/\bdataLagDays\s*=\s*(\d+)/gi, 'defasagem de $1 dia(s)')
    .replace(/\bcurrentTotals\b/gi, 'resultado atual')
    .replace(/\bpreviousComparableTotals\b/gi, 'período anterior comparável')
    .replace(/\bgoals\b/gi, 'metas')
    .replace(/\bROAS\b/g, 'retorno de mídia')
    .replace(/dailyData\.periodAggregates\[\]\.negativeMarginSummary\.bySku/gi, 'recorte diário da base por SKU')
    .replace(/\bdailyData\b/g, 'recorte diário da base')
    .replace(/\bperiodAggregates\b/g, 'período consolidado')
    .replace(/\bcompleteBase\b/g, 'base consolidada')
    .replace(/\btargetedData\b/g, 'recorte específico')
    .replace(/\broas\b/g, 'retorno de mídia')
    .replace(/(^|\n)\s*[-•]\s*item\s+/gi, '$1- ')
    .replace(/\bPontos de atencao:/gi, 'Pontos de atenção:')
    .replace(/\bAcoes imediatas:/gi, 'Ações imediatas:')
    .replace(/\bstop-sale\b/gi, 'suspensão temporária da venda')
    .replace(/\blinearizado\b/gi, 'projetado pelo ritmo médio diário')
    .replace(/\bmargem bruta\b/gi, 'margem de contribuição')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function generateIntelligentAnalysis(force) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const currentSignature = getPublishedDataSignature();
  const cached = readIntelligentAnalysisCache();
  if (!force && cached && cached.signature === currentSignature && cached.analysis) {
    return Object.assign({ cached: true }, cached);
  }

  const analytics = buildIntelligentAnalytics();
  if (!analytics) {
    throw new Error('Nenhuma base processada disponivel para a Analise Inteligente.');
  }

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY nao configurada no servidor.');
  }

  const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'Voce e um CFO, Controller e especialista senior em e-commerce e marketplaces.',
        'Responda sempre em portugues do Brasil, com linguagem simples, executiva e objetiva.',
        'Use exclusivamente os numeros fornecidos. Nunca invente dados, causas, metas, conversao ou indicadores indisponiveis.',
        'Quando um KPI estiver indisponivel ou for apenas uma aproximacao, declare isso claramente.',
        'O mes atual e parcial. O MTD Forecast soma diretamente a mesma quantidade de dias distintos alimentados no Actual. Nunca escreva como se o mes ja tivesse terminado.',
        'O MTD Forecast e a soma direta dos primeiros dias do Forecast diario, usando a mesma quantidade de datas distintas com Actual carregado.',
        'Nao rateie novamente o Forecast diario e nao inclua dias sem Actual no MTD.',
        'Use periodContext para informar claramente a data de corte, os dias transcorridos e quantos dias faltam.',
        'Se dataLagDays for maior que zero, avise que existem dias ainda nao alimentados e nao atribua resultado aos dias ausentes.',
        'Para meses anteriores a 01/06/2026, o comparativo foi estimado por: total do mes anterior dividido pelos dias daquele mes, multiplicado pelos dias fechados do mes atual.',
        'A partir de 01/06/2026, compare o realizado com o MTD Forecast usando os dados diarios reais do mesmo numero de dias.',
        'Explique quando o comparativo for estimado e nao apresente a estimativa como dado realizado.',
        'Nao compare o realizado parcial diretamente com meses completos. Separe realizado nos dias alimentados, ritmo atual e projecao de fechamento.',
        'A projecao de fechamento e uma estimativa linear baseada no ritmo medio diario; identifique-a como projecao, nunca como resultado realizado.',
        'Compare tambem o realizado com o Forecast da base, que representa as metas e o orcamento do periodo.',
        'Explique se o crescimento gera lucro ou apenas faturamento, se a margem melhora ou piora, se publicidade gera retorno e onde o negocio perde dinheiro.',
        'Considere faturamento bruto e liquido, quantidade, ticket medio, GM em reais e percentual, publicidade, investimento em afiliados, TACOS, ACOS, faturamento atribuido ADS F e participacao da receita dos anuncios.',
        'Identifique crescimento e queda por marketplace, categoria, SKU e anuncio, concentracao de receita, margem negativa, publicidade ineficiente e oportunidades de escala.',
        'Use explicitamente os blocos goals, abc e risks para avaliar atingimento das metas, concentracao da Curva ABC e riscos operacionais.',
        'O contexto consolida Base de dados, Marketplace Dashboard, Dashboard Macro, Metas, Curva ABC, Publicidade, Alertas operacionais e Historico de Venda. Cruze os blocos e nao analise cada um isoladamente.',
        'Avalie todos os canais, categorias, SKUs e anuncios presentes no contexto, incluindo os melhores, os piores, os de maior investimento e os de margem negativa.',
        'Cada conclusao deve citar valores, percentuais, nomes de canais, categorias, SKUs ou anuncios presentes no contexto.',
        'As recomendacoes devem dizer o que fazer, por que fazer e a prioridade.',
        'A propriedade businessNarrative deve responder de forma clara: o que aconteceu, o que melhorou, o que piorou, o que exige atencao, acoes imediatas e oportunidades de lucro.',
        'Organize cada texto em paragrafos curtos, com uma ideia principal por paragrafo, pontuacao correta e transicoes claras.',
        'Separe os paragrafos com uma linha em branco.',
        'No resumo executivo, siga esta ordem: situacao atual, desempenho financeiro, rentabilidade, publicidade, riscos e recomendacao principal.',
        'Em businessNarrative, use exatamente estes subtitulos: O que aconteceu:, O que melhorou:, O que piorou:, Pontos de atencao:, Acoes imediatas: e Oportunidades:.',
        'Nunca exponha nomes internos dos campos ou variaveis, como mtdDay, actualDataDay, dataLagDays, forecastToDate, currentTotals, goals ou risks.',
        'Converta nomes tecnicos para linguagem natural. Exemplo: em vez de actualDataDay=17, escreva dados realizados ate o dia 17.',
        'Nao inicie o texto com expressoes redundantes como Resumo Executivo ou O que aconteceu, pois o titulo da secao ja informa o assunto.',
        'Evite jargoes desnecessarios. Quando usar termos como TACOS ou ACOS, explique brevemente o significado no contexto.',
        'Use linguagem profissional, direta e facil de compreender por gestores financeiros, comerciais e operacionais.',
        'Seja direto: executiveSummary deve ter de 180 a 280 palavras; financialDiagnosis, kpiAssessment e businessNarrative de 120 a 220 palavras cada.',
        'Entregue tendencias, alertas e recomendacoes diferentes entre si e fundamentados em evidencias numericas.'
      ].join(' '),
      reasoning: { effort: 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: 'intelligent_business_analysis',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              executiveSummary: { type: 'string' },
              businessNarrative: { type: 'string' },
              financialDiagnosis: { type: 'string' },
              kpiAssessment: { type: 'string' },
              trends: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    evidence: { type: 'string' },
                    diagnosis: { type: 'string' },
                    action: { type: 'string' }
                  },
                  required: ['title', 'evidence', 'diagnosis', 'action'],
                  additionalProperties: false
                }
              },
              alerts: {
                type: 'array',
                minItems: 4,
                maxItems: 4,
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    evidence: { type: 'string' },
                    diagnosis: { type: 'string' },
                    action: { type: 'string' }
                  },
                  required: ['title', 'evidence', 'diagnosis', 'action'],
                  additionalProperties: false
                }
              },
              recommendations: {
                type: 'array',
                minItems: 5,
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    evidence: { type: 'string' },
                    diagnosis: { type: 'string' },
                    action: { type: 'string' }
                  },
                  required: ['title', 'evidence', 'diagnosis', 'action'],
                  additionalProperties: false
                }
              }
            },
            required: [
              'executiveSummary', 'businessNarrative', 'financialDiagnosis',
              'kpiAssessment', 'trends', 'alerts', 'recommendations'
            ],
            additionalProperties: false
          }
        }
      },
      input: 'Dados consolidados do negocio:\n' + JSON.stringify(compactIntelligentAnalytics(analytics)),
      max_output_tokens: 4000
    })
  });
  const result = await openAiResponse.json().catch(() => ({}));

  if (!openAiResponse.ok) {
    const message = result.error && result.error.message
      ? result.error.message
      : 'Nao foi possivel gerar a Analise Inteligente.';
    throw new Error(message);
  }

  const responseText = extractResponseText(result);
  const analysis = parseIntelligentStructuredAnalysis(responseText);
  if (!analysis
      || analysis.executiveSummary.length < 300
      || analysis.businessNarrative.length < 200
      || analysis.financialDiagnosis.length < 200
      || analysis.kpiAssessment.length < 200
      || analysis.trends.length < 4
      || analysis.alerts.length < 4
      || analysis.recommendations.length < 5) {
    throw new Error('A analise retornada ficou incompleta. Ela sera gerada novamente.');
  }

  const generated = {
    signature: analytics.generatedFrom,
    model,
    generatedAt: new Date().toISOString(),
    analysis,
    analytics
  };
  writeIntelligentAnalysisCache(generated);
  return Object.assign({ cached: false }, generated);
}

function ensureIntelligentAnalysis(force) {
  if (intelligentAnalysisPromise) {
    return intelligentAnalysisPromise;
  }

  intelligentAnalysisPromise = generateIntelligentAnalysis(force)
    .finally(() => {
      intelligentAnalysisPromise = null;
    });
  return intelligentAnalysisPromise;
}

async function handleIntelligentAnalysis(request, response) {
  const cached = readIntelligentAnalysisCache();
  const currentSignature = getPublishedDataSignature();

  if (cached && cached.analysis) {
    const stale = cached.signature !== currentSignature;
    const refreshedAnalytics = buildIntelligentAnalytics();
    sendJson(response, 200, Object.assign({ cached: true, stale }, cached, {
      analytics: refreshedAnalytics || cached.analytics
    }));
    if (stale) {
      setImmediate(() => {
        ensureIntelligentAnalysis(true).catch((error) => {
          console.error('Nao foi possivel atualizar a Analise Inteligente em segundo plano:', error.message);
        });
      });
    }
    return;
  }

  try {
    const result = await ensureIntelligentAnalysis(false);
    sendJson(response, 200, result);
  } catch (error) {
    console.error('Erro na Analise Inteligente:', error);
    sendJson(response, 500, { error: error.message || 'Erro ao gerar Analise Inteligente.' });
  }
}

function requireAdmin(request, response) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) { sendJson(response, 500, { error: 'ADMIN_PASSWORD nao configurada.' }); return false; }
  if (!safePasswordEquals(request.headers['x-admin-password'] || '', configured)) {
    sendJson(response, 401, { error: 'Senha invalida.' }); return false;
  }
  return true;
}

const server = http.createServer((request, response) => {
  let requestPath;

  try {
    requestPath = new URL(request.url, 'http://localhost').pathname;
  } catch (error) {
    sendText(response, 400, 'Requisicao invalida.');
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/latest-base') {
    const month = getMonthFromUrl(request.url);
    sendJson(response, 200, month ? getPublishedMetadata(month) : getAllPublishedMetadata());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/admin/validate') {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, { valid: true });
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/upload-base') {
    handleBaseUpload(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/upload-rows') {
    handleRowsUpload(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/forecast') {
    sendJson(response, 200, getForecastStatus());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/forecast') {
    handleForecastPublish(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/ads-base') {
    handleAdsBaseUpload(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/marketplace-accounts') {
    sendJson(response, 200, { accounts: getRegisteredMarketplaceAccounts() });
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/intelligent-analysis') {
    handleIntelligentAnalysis(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/copilot-chat') {
    handleCopilotChat(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/product-master') {
    sendJson(response, 200, syncProductMasterFromPublishedRows(readProductMaster()));
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/product-master') {
    handleProductMasterUpdate(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/product-master/apply') {
    handleApplyProductCategories(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/inventory') {
    sendJson(response, 200, readInventory());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/inventory') {
    handleInventoryUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/inventory-full') {
    sendJson(response, 200, readInventoryFull());
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/sales-treaters') {
    sendJson(response, 200, readSalesTreaters());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/sales-treaters') {
    handleSalesTreatersUpdate(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/sales-treaters/shopee-transform') {
    handleShopeeSalesTransform(request, response);
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/sales-treaters/tiktok-transform') {
    handleMarketplaceSalesTransform(request, response, 'tiktok');
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/sales-treaters/amazon-transform') {
    handleMarketplaceSalesTransform(request, response, 'amazon');
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/sales-treaters/magalu-transform') {
    handleMarketplaceSalesTransform(request, response, 'magalu');
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/inventory-full') {
    handleInventoryFullUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/pricing-rules') {
    sendJson(response, 200, readPricingRules());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/pricing-rules') {
    handlePricingRulesUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/pricing-database') {
    sendJson(response, 200, readPricingDatabase());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/pricing-database') {
    handlePricingDatabaseUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/budgets') {
    sendJson(response, 200, readBudgets());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/budgets') {
    handleBudgetsUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/accounts') {
    sendJson(response, 200, readAccounts());
    return;
  }

  if (request.method === 'POST' && requestPath === '/api/accounts') {
    handleAccountsUpdate(request, response);
    return;
  }

  if (request.method === 'GET' && requestPath === '/api/financial-options') {
    sendJson(response, 200, { options: readFinancialOptions() });
    return;
  }

  const filePath = resolvePublicFile(request.url);

  if (!filePath) {
    sendText(response, 404, 'Arquivo nao encontrado.');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const isPublishedDataFile = !path.relative(dataDir, filePath).startsWith('..') && !path.isAbsolute(path.relative(dataDir, filePath));
  const cacheControl = filePath === path.join(projectDir, 'index.html') || isPublishedDataFile
    ? 'no-store'
    : 'public, max-age=31536000, immutable';
  sendFile(response, filePath, mimeTypes[extension] || 'application/octet-stream', cacheControl);
});

server.requestTimeout = 60 * 60 * 1000;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 65 * 1000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Dashboard rodando na porta ${port}`);
});

