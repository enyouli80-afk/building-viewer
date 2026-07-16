/**
 * Viewer.js — Three.js 核心渲染引擎
 * PBR 管线、HDR 环境贴图、阴影、OrbitControls、模型加载
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/* ---- 设备检测 ---- */
const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);
const isLowPower = (navigator.hardwareConcurrency || 8) < 4;

/* ---- 默认配置 ---- */
const DEFAULTS = {
  cameraFov: 50,
  cameraNear: 0.1,
  cameraFar: 200,
  shadowMapSize: isMobile || isLowPower ? 1024 : 2048,
  pixelRatio: Math.min(window.devicePixelRatio, isMobile ? 2 : 2),
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.0,
};

export class Viewer {
  constructor(canvas) {
    if (!canvas) throw new Error('Viewer: canvas element is required');
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.modelRoot = null;
    this.pmremGenerator = null;
    this.envMap = null;
    this.animationId = null;
    this.isRunning = false;
    this._onRender = null; // external render hook
    this._clock = new THREE.Clock();

    // Public state
    this.modelBoundingSphere = new THREE.Sphere();
    this.modelCenter = new THREE.Vector3();
    this.modelSize = 0;
  }

  /**
   * 初始化渲染器、场景、相机、灯光、控制器
   */
  async init() {
    this._setupRenderer();
    this._setupScene();
    this._setupCamera();
    this._setupLights();
    this._setupEnvironment();
    this._setupControls();
    this._setupGround();
    this._bindEvents();
    return this;
  }

  /* ---------- 渲染器 ---------- */
  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !isLowPower,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(DEFAULTS.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = DEFAULTS.toneMapping;
    this.renderer.toneMappingExposure = DEFAULTS.toneMappingExposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x0a0a0f);
  }

  /* ---------- 场景 ---------- */
  _setupScene() {
    this.scene = new THREE.Scene();
    // 场景雾让远景自然淡出
    this.scene.fog = new THREE.Fog(0x0a0a0f, 30, 100);
  }

  /* ---------- 相机 ---------- */
  _setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      DEFAULTS.cameraFov,
      window.innerWidth / window.innerHeight,
      DEFAULTS.cameraNear,
      DEFAULTS.cameraFar,
    );
    this.camera.position.set(10, 6, 10);
    this.camera.lookAt(0, 0, 0);
  }

  /* ---------- 灯光 ---------- */
  _setupLights() {
    // 环境光 — 基础填充
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    ambient.name = 'ambient';
    this.scene.add(ambient);

    // 半球光 — 天空/地面模拟
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x8899aa, 0.6);
    hemi.name = 'hemisphere';
    this.scene.add(hemi);

    // 主方向光 — 太阳光，投射阴影
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.name = 'sun';
    this.sunLight.position.set(15, 20, 10);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = DEFAULTS.shadowMapSize;
    this.sunLight.shadow.mapSize.height = DEFAULTS.shadowMapSize;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 80;
    this.sunLight.shadow.camera.left = -20;
    this.sunLight.shadow.camera.right = 20;
    this.sunLight.shadow.camera.top = 20;
    this.sunLight.shadow.camera.bottom = -20;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);

    // 补光 — 减少暗面过黑
    const fill = new THREE.DirectionalLight(0xaaccff, 0.8);
    fill.name = 'fill';
    fill.position.set(-5, 3, -5);
    this.scene.add(fill);
  }

  /* ---------- 环境贴图 ---------- */
  _setupEnvironment() {
    // 先用 PMREMGenerator 准备，后续加载 HDR 或使用内置环境
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileEquirectangularShader();

    // 默认：使用内置 RoomEnvironment（中性室内光照）
    // 在 loadEnvironment 中可替换为自定义 HDR
    const roomEnv = this.pmremGenerator.fromScene(
      new THREE.RoomEnvironment(), 0.04
    );
    this.scene.environment = roomEnv.texture;
    this.envMap = roomEnv.texture;
    roomEnv.texture.dispose = () => {}; // 保持引用
  }

  /**
   * 加载 HDR 环境贴图（可选，增强反射真实感）
   */
  async loadEnvironment(url) {
    try {
      const rgbeLoader = new RGBELoader();
      rgbeLoader.setDataType(THREE.HalfFloatType);
      const hdrTexture = await new Promise((resolve, reject) => {
        rgbeLoader.load(url, resolve, undefined, reject);
      });
      hdrTexture.colorSpace = THREE.SRGBColorSpace;

      const envMap = this.pmremGenerator.fromEquirectangular(hdrTexture);
      this.scene.environment = envMap.texture;
      this.scene.background = envMap.texture;
      this.envMap = envMap.texture;

      hdrTexture.dispose();
      return true;
    } catch (err) {
      console.warn('Viewer: HDR load failed, using default environment', err);
      return false;
    }
  }

  /* ---------- 轨道控制器 ---------- */
  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 50;
    this.controls.maxPolarAngle = Math.PI * 0.78; // 防止翻到底部
    this.controls.target.set(0, 1.5, 0);
    this.controls.update();
    // 默认禁用（由 main.js 按模式控制）
    this.controls.enabled = false;
  }

  /* ---------- 地面投影平面 ---------- */
  _setupGround() {
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.position.y = -0.05;
    this.groundPlane.receiveShadow = true;
    this.groundPlane.name = 'ground';
    this.scene.add(this.groundPlane);
  }

  /* ---------- GLB 模型加载 ---------- */
  /**
   * 加载 GLB 模型，返回根节点
   * @param {string} url
   * @param {(pct: number) => void} onProgress
   */
  async loadModel(url, onProgress) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.load(
        url,
        resolve,
        (e) => {
          if (e.total > 0 && onProgress) {
            onProgress(e.loaded / e.total);
          }
        },
        reject,
      );
    });

    this.modelRoot = gltf.scene;
    this.modelRoot.name = 'model-root';

    // 遍历所有 mesh，启用阴影 + 优化材质
    this.modelRoot.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        // 确保材质使用场景环境贴图
        if (node.material) {
          const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
          materials.forEach((mat) => {
            mat.needsUpdate = true;
            // 如果没有 roughness/metalness，给一个合理的默认值
            if (mat.roughness === undefined) mat.roughness = 0.7;
            if (mat.metalness === undefined) mat.metalness = 0.0;
          });
        }
      }
    });

    this.scene.add(this.modelRoot);
    this._autoFrame();
    this._fitShadowCamera();

    return this.modelRoot;
  }

  /* ---------- 自动取景 ---------- */
  _autoFrame() {
    if (!this.modelRoot) return;

    const box = new THREE.Box3().setFromObject(this.modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    this.modelCenter.copy(center);
    this.modelSize = size.length();

    // 包围球
    this.modelBoundingSphere.set(center, size.length() / 2);

    // 调整地面位置
    if (this.groundPlane) {
      this.groundPlane.position.y = box.min.y - 0.05;
      const groundSize = Math.max(size.x, size.z) * 2.5;
      this.groundPlane.scale.set(groundSize / 60, groundSize / 60, 1);
    }

    // 调整相机距离
    const radius = this.modelBoundingSphere.radius * 2.5;
    this.camera.position.set(radius * 0.7, radius * 0.5, radius * 0.7);
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.15;
    this.controls.maxDistance = radius * 5;
    this.controls.update();

    // 更新场景雾
    if (this.scene.fog) {
      this.scene.fog.near = radius * 4;
      this.scene.fog.far = radius * 10;
    }
  }

  /* ---------- 适配阴影相机 ---------- */
  _fitShadowCamera() {
    if (!this.modelRoot || !this.sunLight) return;
    const sphere = this.modelBoundingSphere;
    const r = sphere.radius * 1.5;
    this.sunLight.shadow.camera.left = -r;
    this.sunLight.shadow.camera.right = r;
    this.sunLight.shadow.camera.top = r;
    this.sunLight.shadow.camera.bottom = -r;
    this.sunLight.shadow.camera.updateProjectionMatrix();
  }

  /* ---------- 渲染循环 ---------- */
  startLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._clock.start();
    this._tick();
  }

  stopLoop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  _tick = () => {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(this._tick);

    const dt = Math.min(this._clock.getDelta(), 0.1); // 防止大帧跳跃

    this.controls.update();

    // 外部渲染钩子（用于标注投影、动画更新等）
    if (this._onRender) {
      this._onRender(dt);
    }

    this.renderer.render(this.scene, this.camera);
  };

  /**
   * 注册每帧回调
   */
  onRender(fn) {
    this._onRender = fn;
  }

  /* ---------- 窗口大小调整 ---------- */
  _bindEvents() {
    window.addEventListener('resize', this._onResize);
  }

  _onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  };

  /* ---------- 获取视图信息 ---------- */
  getViewInfo() {
    return {
      cameraPos: this.camera.position.clone(),
      lookAt: this.controls.target.clone(),
      boundingSphere: this.modelBoundingSphere.clone(),
      modelCenter: this.modelCenter.clone(),
      modelSize: this.modelSize,
    };
  }

  /* ---------- 资源释放 ---------- */
  dispose() {
    this.stopLoop();
    this.controls.dispose();
    this.renderer.dispose();

    if (this.modelRoot) {
      this.modelRoot.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((m) => {
            Object.values(m).forEach((v) => {
              if (v && v.isTexture) v.dispose();
            });
            m.dispose();
          });
        }
      });
    }

    if (this.envMap && this.envMap.dispose) this.envMap.dispose();
    this.pmremGenerator.dispose();
    window.removeEventListener('resize', this._onResize);
  }
}
