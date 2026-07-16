/**
 * Main.js — 应用入口，模块编排
 * 初始化渲染器、爆炸引擎、滚动导览、UI 交互、QR 码
 */

import { Viewer } from './viewer.js';
import { ExplodeEngine } from './explode.js';
import * as THREE from 'three';

/* ============================================================
   部署配置
   ============================================================ */
// 本地模型路径（同源部署，直接加载，无 CORS 问题）
const LOCAL_MODEL_PATH = 'assets/model.glb';

// 云端模型 URL（可选，用于外部 CDN 等）
const CLOUD_MODEL_URL = '';

/* ============================================================
   应用状态
   ============================================================ */
const STATE = {
  LOADING: 'loading',
  READY: 'ready',
  TOURING: 'touring',
  EXPLORING: 'exploring',
};

let appState = STATE.LOADING;
let viewer, explodeEngine;

/* ============================================================
   DOM 引用
   ============================================================ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  loadingScreen: $('#loading-screen'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  scrollContainer: $('#scroll-container'),
  sectionDots: $$('#section-dots .dot'),
  explodeSlider: $('#explode-slider'),
  btnAutoExplode: $('#btn-auto-explode'),
  btnFreeMode: $('#btn-free-mode'),
  btnResetView: $('#btn-reset-view'),
  btnQR: $('#btn-qr'),
  btnQRMain: $('#btn-qr-main'),
  qrModal: $('#qr-modal'),
  btnQRClose: $('#btn-qr-close'),
  qrCodeImg: $('#qr-code-img'),
  qrUrlInput: $('#qr-url-input'),
  btnCopyUrl: $('#btn-copy-url'),
  annotationsLayer: $('#annotations-layer'),
};

/* ============================================================
   导览关键帧系统
   ============================================================ */
/**
 * 每个 TourStop 定义了一个滚动位置对应的 3D 状态
 * cameraPosition / cameraLookAt: 相机位置和目标
 * explodeAmount: 爆炸强度 0-1
 * annotation: 可选标注文本
 */
const tourStops = [
  {
    id: 'hero',
    progress: 0.0,
    cameraPosition: [10, 5.5, 10],
    cameraLookAt: [0, 1.5, 0],
    explodeAmount: 0,
  },
  {
    id: 'overview',
    progress: 0.18,
    cameraPosition: [7, 4, 8],
    cameraLookAt: [0, 1.2, 0],
    explodeAmount: 0,
    annotation: '建筑全貌 · 自由旋转查看',
    annotationPos: [0, 3, 0],
  },
  {
    id: 'exploded',
    progress: 0.38,
    cameraPosition: [5, 4.5, 9],
    cameraLookAt: [0, 2, 0],
    explodeAmount: 1.0,
    annotation: '爆炸视图 · 组件分解展示',
    annotationPos: [0, 4.5, 0],
  },
  {
    id: 'detail',
    progress: 0.58,
    cameraPosition: [2.5, 2, 4.5],
    cameraLookAt: [0.5, 1.2, 0],
    explodeAmount: 0,
    annotation: '入口细节 · 近距离查看',
    annotationPos: [0.5, 1.8, 1],
  },
  {
    id: 'topview',
    progress: 0.78,
    cameraPosition: [0.5, 12, 0.5],
    cameraLookAt: [0, 1.5, 0],
    explodeAmount: 0,
    annotation: '俯视平面 · 空间布局一览',
    annotationPos: [0, 5, 0],
  },
  {
    id: 'summary',
    progress: 0.95,
    cameraPosition: [8, 5, 10],
    cameraLookAt: [0, 1.5, 0],
    explodeAmount: 0,
  },
];

let currentStopIndex = 0;
let scrollProgress = 0;
let targetCamPos = new THREE.Vector3();
let targetLookAt = new THREE.Vector3();
let isTourMode = true;

/* ============================================================
   初始化
   ============================================================ */
async function init() {
  try {
    // 修复移动端 100vh 问题
    fixViewportHeight();

    // 初始化 Viewer
    const canvas = $('#three-canvas');
    viewer = new Viewer(canvas);
    await viewer.init();

    // 初始化爆炸引擎
    explodeEngine = new ExplodeEngine();

    // 注册渲染钩子（在 viewer 渲染循环中每帧调用）
    viewer.onRender((dt) => {
      explodeEngine.update(dt);
      updateCameraLerp(dt);
      updateAnnotations();
    });

    // 加载模型（同源 assets/model.glb，38MB meshopt 压缩）
    await loadModelAuto();

    // 启动渲染循环
    viewer.startLoop();

    // 设置 UI
    setupUI();
    setupScrollHandling();
    setupQRCode();

    // 初始化导览关键帧（基于实际模型尺寸调整）
    calibrateTourStops();

    // 就绪
    setAppState(STATE.READY);
    enterTourMode();

    // 隐藏加载画面
    setTimeout(() => {
      dom.loadingScreen.classList.add('hidden');
    }, 400);

  } catch (err) {
    console.error('初始化失败:', err);
    showError(err.message);
  }
}

/* ============================================================
   模型加载（自动检测格式）
   ============================================================ */
/**
 * 自动加载模型，优先级：
 * 1. URL 参数 ?model=https://... （云端大文件）
 * 2. CLOUD_MODEL_URL 配置（外部 CDN 等）
 * 3. LOCAL_MODEL_PATH（同源部署，推荐）
 * 4. assets/model.gltf
 * 5. 演示占位场景
 */
async function loadModelAuto() {
  updateProgress(0, '准备加载模型...');
  await sleep(200);
  updateProgress(8, '正在初始化渲染器...');

  // 1. URL 参数 ?model=xxx（临时覆盖）
  // 2. CLOUD_MODEL_URL 配置（外部 CDN 等）
  const urlParams = new URLSearchParams(window.location.search);
  const externalUrl = urlParams.get('model') || CLOUD_MODEL_URL;

  if (externalUrl) {
    updateProgress(12, '从云端加载模型...');
    try {
      const modelRoot = await viewer.loadModel(externalUrl, (pct) => {
        const progress = 15 + pct * 70;
        updateProgress(progress, `加载中... ${Math.round(pct * 100)}%`);
      });

      updateProgress(88, '分析模型结构...');
      await sleep(100);
      explodeEngine.init(modelRoot);
      updateProgress(100, '完成');
      await sleep(300);
      return;
    } catch (err) {
      console.warn('云端模型加载失败，尝试本地文件:', err.message);
      updateProgress(15, '云端加载失败，尝试本地...');
    }
  }

  // 3. 本地模型文件（同源部署，推荐方式）
  const modelPaths = [
    { url: LOCAL_MODEL_PATH, name: 'GLB 二进制格式' },
    { url: 'assets/model.gltf', name: 'glTF JSON 格式' },
  ];

  for (const { url, name } of modelPaths) {
    updateProgress(12, `尝试加载 ${name}...`);
    try {
      const modelRoot = await viewer.loadModel(url, (pct) => {
        const progress = 15 + pct * 70;
        updateProgress(progress, `加载模型中... ${Math.round(pct * 100)}%`);
      });

      updateProgress(88, '分析模型结构...');
      await sleep(100);

      explodeEngine.init(modelRoot);
      updateProgress(95, '准备完毕...');

      const groupCount = explodeEngine.getGroupCount();
      console.log(`✅ 模型加载成功 (${name})，检测到 ${groupCount} 个分组`);
      if (groupCount < 2) {
        console.warn('⚠️ 模型分组较少，爆炸效果可能有限。请在 SketchUp 中将模型建组后重新导出。');
      }

      updateProgress(100, '完成');
      await sleep(300);
      return;

    } catch (err) {
      console.warn(`❌ ${name} 加载失败:`, err.message);
    }
  }

  // 全部失败 → 演示场景
  console.warn('所有模型路径均加载失败，使用演示占位体');
  updateProgress(30, '未找到模型文件，正在生成演示场景...');
  await sleep(300);
  createDemoScene();
  explodeEngine.init(viewer.modelRoot);
  updateProgress(100, '演示场景就绪');
  await sleep(300);
}

/**
 * 创建演示场景（当 GLB 不存在时）
 */
function createDemoScene() {
  const root = new THREE.Group();
  root.name = 'demo-model';

  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xe8e0d8, roughness: 0.6, metalness: 0.05 }), // 主体
    new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.5, metalness: 0.1 }),  // 立面
    new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.15, metalness: 0.3 }),  // 玻璃
    new THREE.MeshStandardMaterial({ color: 0xc44d34, roughness: 0.7, metalness: 0.0 }),  // 强调
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.8 }),  // 金属
  ];

  // 主体建筑
  const body = createBox(4, 3, 3, materials[0], '主体结构');
  body.position.set(0, 1.5, 0);
  root.add(body);

  // 屋顶
  const roof = createBox(4.4, 1.2, 3.4, materials[1], '屋顶');
  roof.position.set(0, 3.6, 0);
  root.add(roof);

  // 玻璃幕墙
  const glass = createBox(2, 2.5, 0.15, materials[2], '玻璃幕墙');
  glass.position.set(0, 1.7, 1.6);
  root.add(glass);

  // 入口
  const entrance = createBox(1.2, 2.2, 0.8, materials[3], '入口');
  entrance.position.set(0, 1.1, 1.8);
  root.add(entrance);

  // 基座
  const base = createBox(5, 0.3, 4, materials[4], '基座');
  base.position.set(0, 0.05, 0);
  root.add(base);

  viewer.modelRoot = root;
  viewer.scene.add(root);
  viewer._autoFrame();
  viewer._fitShadowCamera();

  // 显示提示
  const notice = document.createElement('div');
  notice.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: rgba(255,200,50,0.15); border: 1px solid rgba(255,200,50,0.3);
    border-radius: 8px; padding: 10px 20px; z-index: 30;
    color: #ffc832; font-size: 0.85rem; text-align: center;
    backdrop-filter: blur(10px); pointer-events: none;
  `;
  notice.textContent = '⚠️ 未找到模型文件 — 当前为演示场景。请将 SKP 导出的 GLB 文件放入 assets/model.glb';
  document.body.appendChild(notice);
  setTimeout(() => { notice.style.opacity = '0'; notice.style.transition = 'opacity 8s'; }, 5000);
}

function createBox(w, h, d, material, name) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = name;
  group.add(mesh);
  return group;
}

/* ============================================================
   导览关键帧校准
   ============================================================ */
function calibrateTourStops() {
  const info = viewer.getViewInfo();
  const r = info.boundingSphere.radius;
  const center = info.modelCenter;

  // 根据实际模型尺寸调整相机距离
  const scale = Math.max(r / 3, 1); // 以 r=3 为基准

  tourStops.forEach((stop) => {
    // 缩放位置偏移
    const basePos = new THREE.Vector3(...stop.cameraPosition);
    const dirFromCenter = basePos.clone().sub(new THREE.Vector3(0, center.y, 0)).normalize();
    const dist = basePos.length() * scale;
    const newPos = dirFromCenter.multiplyScalar(dist).add(
      new THREE.Vector3(0, center.y, 0)
    );
    stop.cameraPosition = [newPos.x, newPos.y, newPos.z];

    // 更新 LookAt 到模型中心
    if (stop.cameraLookAt) {
      stop.cameraLookAt = [
        center.x + (stop.cameraLookAt[0] || 0),
        center.y,
        center.z + (stop.cameraLookAt[2] || 0),
      ];
    }

    // 更新标注位置
    if (stop.annotationPos) {
      stop.annotationPos = [
        center.x + stop.annotationPos[0] * scale,
        center.y + stop.annotationPos[1] * scale,
        center.z + stop.annotationPos[2] * scale,
      ];
    }
  });

  // 初始化目标相机
  targetCamPos.set(...tourStops[0].cameraPosition);
  targetLookAt.set(...tourStops[0].cameraLookAt);
}

/* ============================================================
   滚动处理
   ============================================================ */
function setupScrollHandling() {
  dom.scrollContainer.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', fixViewportHeight);
  window.addEventListener('orientationchange', () => {
    setTimeout(fixViewportHeight, 200);
  });
}

function onScroll() {
  if (!isTourMode) return;

  const container = dom.scrollContainer;
  const maxScroll = container.scrollHeight - container.clientHeight;
  scrollProgress = maxScroll > 0
    ? THREE.MathUtils.clamp(container.scrollTop / maxScroll, 0, 1)
    : 0;

  // 找到当前区段
  let stopA = tourStops[0];
  let stopB = tourStops[tourStops.length - 1];
  let aIdx = 0, bIdx = tourStops.length - 1;

  for (let i = 0; i < tourStops.length - 1; i++) {
    if (scrollProgress >= tourStops[i].progress && scrollProgress <= tourStops[i + 1].progress) {
      stopA = tourStops[i];
      stopB = tourStops[i + 1];
      aIdx = i;
      bIdx = i + 1;
      break;
    }
  }

  // 区段内插值
  const range = stopB.progress - stopA.progress;
  const localT = range > 0
    ? easeInOutCubic((scrollProgress - stopA.progress) / range)
    : 0;

  // 更新相机目标
  targetCamPos.lerpVectors(
    new THREE.Vector3(...stopA.cameraPosition),
    new THREE.Vector3(...stopB.cameraPosition),
    localT,
  );
  targetLookAt.lerpVectors(
    new THREE.Vector3(...stopA.cameraLookAt),
    new THREE.Vector3(...stopB.cameraLookAt),
    localT,
  );

  // 更新爆炸强度
  const explodeAmt = THREE.MathUtils.lerp(
    stopA.explodeAmount ?? 0,
    stopB.explodeAmount ?? 0,
    localT,
  );
  explodeEngine.setStrength(explodeAmt);

  // 更新滑块（避免循环触发）
  dom.explodeSlider.value = Math.round(explodeAmt * 100);

  // 更新导航点
  updateSectionDots(localT > 0.5 ? bIdx : aIdx);
  currentStopIndex = localT > 0.5 ? bIdx : aIdx;
}

function updateSectionDots(activeIndex) {
  dom.sectionDots.forEach((dot, i) => {
    dot.classList.toggle('active', i === activeIndex);
  });
}

/* ============================================================
   相机平滑跟随
   ============================================================ */
function updateCameraLerp(dt) {
  if (!isTourMode) return;

  const lerpSpeed = 3.5;
  const amount = Math.min(lerpSpeed * dt, 1);

  viewer.camera.position.lerp(targetCamPos, amount);
  viewer.controls.target.lerp(targetLookAt, amount);
}

/* ============================================================
   标注系统
   ============================================================ */
const annotationElements = [];

function updateAnnotations() {
  const currentStop = tourStops[currentStopIndex];

  // 清除旧标注
  annotationElements.forEach((el) => el.remove());
  annotationElements.length = 0;

  // 检查当前区段是否有标注
  let activeAnnotation = null;
  for (const stop of tourStops) {
    if (stop.annotation && stop.annotationPos) {
      const dist = Math.abs(scrollProgress - stop.progress);
      if (dist < 0.12) {
        activeAnnotation = stop;
        break;
      }
    }
  }

  if (!activeAnnotation) return;

  const pos = new THREE.Vector3(...activeAnnotation.annotationPos);
  const screenPos = pos.clone().project(viewer.camera);

  // 检查是否在屏幕内
  if (screenPos.z > 1) return; // 在相机后方

  const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

  // 创建标注元素
  const annotation = document.createElement('div');
  annotation.className = 'annotation';
  annotation.style.left = `${x}px`;
  annotation.style.top = `${y}px`;
  annotation.innerHTML = `
    <div class="annotation-dot"></div>
    <div class="annotation-label">${activeAnnotation.annotation}</div>
  `;
  dom.annotationsLayer.appendChild(annotation);
  annotationElements.push(annotation);
}

/* ============================================================
   UI 事件绑定
   ============================================================ */
function setupUI() {
  // 爆炸滑块
  dom.explodeSlider.addEventListener('input', () => {
    const val = parseInt(dom.explodeSlider.value) / 100;
    explodeEngine.setStrength(val);
    // 手动拖滑块时退出自动播放
    if (explodeEngine._autoPlaying) {
      explodeEngine.stopAutoPlay();
      dom.btnAutoExplode.classList.remove('active');
    }
  });

  // 自动爆炸按钮
  dom.btnAutoExplode.addEventListener('click', () => {
    const isPlaying = explodeEngine.toggleAutoPlay();
    dom.btnAutoExplode.classList.toggle('active', isPlaying);
    if (isPlaying) {
      dom.explodeSlider.value = 0;
    }
  });

  // 自由视角按钮
  dom.btnFreeMode.addEventListener('click', () => {
    if (isTourMode) {
      enterFreeMode();
    } else {
      enterTourMode();
    }
  });

  // 重置视角
  dom.btnResetView.addEventListener('click', () => {
    if (tourStops.length > 0) {
      const first = tourStops[0];
      targetCamPos.set(...first.cameraPosition);
      targetLookAt.set(...first.cameraLookAt);
      explodeEngine.reset();
      dom.explodeSlider.value = 0;
      dom.btnAutoExplode.classList.remove('active');
      dom.scrollContainer.scrollTop = 0;
      if (isTourMode) {
        viewer.camera.position.copy(targetCamPos);
        viewer.controls.target.copy(targetLookAt);
      }
    }
  });

  // QR 按钮
  [dom.btnQR, dom.btnQRMain].forEach((btn) => {
    if (btn) btn.addEventListener('click', openQRModal);
  });
  dom.btnQRClose.addEventListener('click', closeQRModal);
  dom.qrModal.addEventListener('click', (e) => {
    if (e.target === dom.qrModal) closeQRModal();
  });

  // 复制链接
  dom.btnCopyUrl.addEventListener('click', copyURL);

  // 键盘快捷键
  window.addEventListener('keydown', onKeyDown);

  // 爆炸引擎回调 — 同步滑块
  explodeEngine.onUpdate((strength) => {
    dom.explodeSlider.value = Math.round(strength * 100);
  });

  // 导航点点击
  dom.sectionDots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      scrollToStop(i);
    });
  });

  // 触摸设备：在画布上双指操作时，暂时禁用滚动
  const canvas = $('#three-canvas');
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length >= 2) {
      dom.scrollContainer.style.overflowY = 'hidden';
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => {
    dom.scrollContainer.style.overflowY = '';
  });
}

/* ============================================================
   模式切换
   ============================================================ */
function enterTourMode() {
  isTourMode = true;
  viewer.controls.enabled = false;
  dom.btnFreeMode.querySelector('span').textContent = '自由视角';
  dom.btnFreeMode.classList.remove('active');
  dom.scrollContainer.style.pointerEvents = 'auto';
  setAppState(STATE.TOURING);

  // 同步当前状态到导览
  onScroll();
}

function enterFreeMode() {
  isTourMode = false;
  viewer.controls.enabled = true;
  dom.btnFreeMode.querySelector('span').textContent = '导览模式';
  dom.btnFreeMode.classList.add('active');
  dom.scrollContainer.style.pointerEvents = 'none';
  setAppState(STATE.EXPLORING);
}

function setAppState(state) {
  appState = state;
}

/* ============================================================
   QR 码
   ============================================================ */
function setupQRCode() {
  const url = window.location.href;
  const qrAPI = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&margin=10`;
  dom.qrCodeImg.src = qrAPI;
  dom.qrUrlInput.value = url;
}

function openQRModal() {
  dom.qrModal.classList.add('active');
  // 重新生成（URL 可能已变）
  const url = window.location.href;
  dom.qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&margin=10`;
  dom.qrUrlInput.value = url;
}

function closeQRModal() {
  dom.qrModal.classList.remove('active');
}

async function copyURL() {
  try {
    await navigator.clipboard.writeText(dom.qrUrlInput.value);
    const btn = dom.btnCopyUrl;
    const originalText = btn.textContent;
    btn.textContent = '已复制 ✓';
    btn.style.borderColor = 'rgba(77, 166, 255, 0.5)';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.borderColor = '';
    }, 2000);
  } catch {
    // 降级方案
    dom.qrUrlInput.select();
    document.execCommand('copy');
  }
}

/* ============================================================
   键盘快捷键
   ============================================================ */
function onKeyDown(e) {
  switch (e.key.toLowerCase()) {
    case 'f':
      // 切换自由模式
      if (isTourMode) enterFreeMode();
      else enterTourMode();
      break;
    case 'e':
      // 切换爆炸自动播放
      dom.btnAutoExplode.click();
      break;
    case 'r':
      // 重置视角
      dom.btnResetView.click();
      break;
    case 'escape':
      closeQRModal();
      break;
    case '1': scrollToStop(0); break;
    case '2': scrollToStop(1); break;
    case '3': scrollToStop(2); break;
    case '4': scrollToStop(3); break;
    case '5': scrollToStop(4); break;
    case '6': scrollToStop(5); break;
  }
}

function scrollToStop(index) {
  if (index < 0 || index >= tourStops.length) return;
  const container = dom.scrollContainer;
  const maxScroll = container.scrollHeight - container.clientHeight;
  const targetScroll = tourStops[index].progress * maxScroll;
  container.scrollTo({ top: targetScroll, behavior: 'smooth' });
}

/* ============================================================
   工具函数
   ============================================================ */
function updateProgress(pct, text) {
  dom.progressFill.style.width = `${Math.round(pct)}%`;
  dom.progressText.textContent = text || `${Math.round(pct)}%`;
}

function fixViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showError(msg) {
  dom.progressFill.style.background = '#ff4444';
  updateProgress(100, `加载失败: ${msg}`);
  console.error(msg);
}

// IE/旧浏览器兼容
if (!window.requestAnimationFrame) {
  alert('您的浏览器版本过低，请使用 Chrome、Firefox、Safari 或 Edge 的最新版本打开。');
}

/* ============================================================
   启动应用
   ============================================================ */
document.addEventListener('DOMContentLoaded', init);
