/**
 * Explode.js — 爆炸视图引擎
 * 遍历场景层级，计算各组的爆炸偏移向量，驱动动画
 */

import * as THREE from 'three';

export class ExplodeEngine {
  constructor() {
    /** @type {Map<string, GroupExplodeInfo>} */
    this.groups = new Map();
    this.modelCenter = new THREE.Vector3();
    this.baseDistance = 0;
    this._currentStrength = 0;
    this._targetStrength = 0;
    this._lerpSpeed = 6.0;
    this._autoPlaying = false;
    this._autoDirection = 1;
    this._autoSpeed = 0.4; // 每秒变化速度
    this._onUpdate = null; // 外部回调
  }

  /**
   * 分析模型场景，提取爆炸参数
   * @param {THREE.Group} modelRoot
   */
  init(modelRoot) {
    if (!modelRoot) {
      console.warn('ExplodeEngine: modelRoot is null');
      return;
    }

    this.groups.clear();
    this._currentStrength = 0;
    this._targetStrength = 0;

    // 1. 遍历顶层子节点，建立分组
    const topChildren = modelRoot.children.filter(
      (c) => c.type === 'Group' || c.type === 'Object3D' || c.type === 'Mesh'
    );

    if (topChildren.length === 0) {
      // 如果只有一个根节点，深入到下一层
      this._collectGroups(modelRoot);
    } else {
      for (const child of topChildren) {
        this._processNode(child);
      }
    }

    // 2. 如果分组太少（可能是整个模型是一个整体），尝试按材质/名称拆分
    if (this.groups.size < 2) {
      console.warn(
        'ExplodeEngine: 检测到的分组较少（%d）。' +
        '请在 SketchUp 中将模型建好组/组件后再导出 GLB，以获得最佳爆炸效果。',
        this.groups.size
      );
      // 如果只有一个组，尝试更深地拆分
      if (this.groups.size <= 1 && topChildren.length === 1) {
        this._deepSplit(topChildren[0]);
      }
    }

    // 3. 计算全局中心点和爆炸距离
    this._computeGlobalParams();

    // 4. 计算每个组的爆炸偏移向量
    this._computeExplosionVectors();

    console.log(
      'ExplodeEngine: 分析完成 — %d 个分组, 模型中心 (%s), 基础爆炸距离 %.2f',
      this.groups.size,
      this.modelCenter.toArray().map(v => v.toFixed(2)).join(', '),
      this.baseDistance.toFixed(2)
    );
  }

  /**
   * 处理单个节点（可能是 Group 或 Mesh）
   */
  _processNode(node) {
    const key = node.name || node.uuid;

    if (this.groups.has(key)) return;

    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return; // 跳过空节点

    const centroid = box.getCenter(new THREE.Vector3());

    this.groups.set(key, {
      key,
      node,
      originalPosition: node.position.clone(),
      worldBox: box.clone(),
      centroid,
      explosionOffset: new THREE.Vector3(),
      depth: 0,
    });
  }

  /**
   * 递归收集所有非空子节点
   */
  _collectGroups(root) {
    for (const child of root.children) {
      if (child.isMesh) {
        this._processNode(child);
      } else if (child.children && child.children.length > 0) {
        this._processNode(child);
      }
    }
  }

  /**
   * 深度拆分：递归下钻直到找到合适数量的分组（5~500 个）
   */
  _deepSplit(node) {
    if (!node.children || node.children.length === 0) return;

    // 如果这个层级有 5-500 个子节点，在这里拆分
    if (node.children.length >= 5 && node.children.length <= 500) {
      this.groups.clear();
      for (const child of node.children) {
        this._processNode(child);
      }
      return;
    }

    // 如果只有一个子节点，向下钻取
    if (node.children.length === 1) {
      this._deepSplit(node.children[0]);
      return;
    }

    // 如果子节点太多（>500），也在这里拆分（总比不拆好）
    if (node.children.length > 500) {
      this.groups.clear();
      for (const child of node.children) {
        this._processNode(child);
      }
      return;
    }

    // 如果子节点太少（<5），也向下钻取
    this.groups.clear();
    for (const child of node.children) {
      this._processNode(child);
    }
  }

  /**
   * 计算全局参数：模型中心、基础爆炸距离
   */
  _computeGlobalParams() {
    const allBoxes = new THREE.Box3();
    const centroids = [];

    for (const [, info] of this.groups) {
      allBoxes.expandByObject(info.node);
      centroids.push(info.centroid);
    }

    // 模型中心 = 所有分组包围盒中心的平均值
    if (centroids.length > 0) {
      this.modelCenter.set(0, 0, 0);
      centroids.forEach((c) => this.modelCenter.add(c));
      this.modelCenter.divideScalar(centroids.length);
    } else {
      this.modelCenter.copy(allBoxes.getCenter(new THREE.Vector3()));
    }

    // 基础爆炸距离 = 模型包围球半径的 40%
    const size = allBoxes.getSize(new THREE.Vector3());
    this.baseDistance = Math.max(size.length() * 0.2, 0.5);
  }

  /**
   * 计算每个组的爆炸偏移向量
   */
  _computeExplosionVectors() {
    for (const [, info] of this.groups) {
      const dir = info.centroid.clone().sub(this.modelCenter);

      // 如果方向向量太小（组在中心附近），使用向上的方向
      if (dir.length() < 0.001) {
        dir.set(0, 1, 0);
      } else {
        dir.normalize();
      }

      // 深度加成：嵌套更深的组偏移更大
      const depthMultiplier = 1 + info.depth * 0.3;
      const distance = this.baseDistance * depthMultiplier;

      // 转换为局部空间方向（考虑父节点旋转）
      const localDir = this._worldToLocalDirection(dir, info.node);

      info.explosionOffset.copy(localDir).multiplyScalar(distance);
    }
  }

  /**
   * 将世界空间方向转换为节点局部空间方向
   */
  _worldToLocalDirection(worldDir, node) {
    if (!node.parent) return worldDir.clone();

    // 提取父节点世界矩阵的旋转部分的逆
    const parentMatrix = node.parent.matrixWorld.clone();
    const invRotation = new THREE.Matrix4()
      .extractRotation(parentMatrix)
      .invert();

    const localDir = worldDir.clone()
      .applyMatrix4(invRotation)
      .normalize();

    return localDir;
  }

  /**
   * 设置爆炸强度（0=组装, 1=完全爆炸）
   * @param {number} strength 0-1
   */
  setStrength(strength) {
    this._targetStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  /**
   * 每帧更新 — 在 Viewer.onRender 中调用
   * @param {number} dt 帧间隔时间（秒）
   */
  update(dt) {
    // 自动播放
    if (this._autoPlaying) {
      this._targetStrength += this._autoDirection * this._autoSpeed * dt;
      if (this._targetStrength >= 1) {
        this._targetStrength = 1;
        this._autoDirection = -1;
      } else if (this._targetStrength <= 0) {
        this._targetStrength = 0;
        this._autoDirection = 1;
      }
    }

    // 平滑插值
    const prev = this._currentStrength;
    const lerpAmount = Math.min(this._lerpSpeed * dt, 1);
    this._currentStrength = THREE.MathUtils.lerp(
      this._currentStrength,
      this._targetStrength,
      lerpAmount
    );

    // 只有变化时才更新位置
    if (Math.abs(this._currentStrength - prev) < 1e-6) return;

    for (const [, info] of this.groups) {
      const ox = info.explosionOffset.x * this._currentStrength;
      const oy = info.explosionOffset.y * this._currentStrength;
      const oz = info.explosionOffset.z * this._currentStrength;
      info.node.position.set(
        info.originalPosition.x + ox,
        info.originalPosition.y + oy,
        info.originalPosition.z + oz,
      );
    }

    // 外部回调（用于同步 UI 滑块等）
    if (this._onUpdate) {
      this._onUpdate(this._currentStrength);
    }
  }

  /**
   * 注册外部更新回调
   */
  onUpdate(fn) {
    this._onUpdate = fn;
  }

  /**
   * 自动播放爆炸动画
   */
  autoPlay() {
    this._autoPlaying = true;
    // 从头开始
    this._targetStrength = 0;
    this._currentStrength = 0;
    this._autoDirection = 1;
  }

  /**
   * 停止自动播放
   */
  stopAutoPlay() {
    this._autoPlaying = false;
    this._targetStrength = 0;
  }

  /**
   * 切换自动播放
   */
  toggleAutoPlay() {
    if (this._autoPlaying) {
      this.stopAutoPlay();
    } else {
      this.autoPlay();
    }
    return this._autoPlaying;
  }

  /**
   * 重置到组装状态
   */
  reset() {
    this.stopAutoPlay();
    this._targetStrength = 0;
    this._currentStrength = 0;
    for (const [, info] of this.groups) {
      info.node.position.copy(info.originalPosition);
    }
  }

  /**
   * 获取当前强度
   */
  getStrength() {
    return this._currentStrength;
  }

  /**
   * 获取分组数量
   */
  getGroupCount() {
    return this.groups.size;
  }

  /**
   * 获取分组信息（用于调试/可视化）
   */
  getGroupInfo() {
    const info = [];
    for (const [, g] of this.groups) {
      info.push({
        name: g.key,
        centroid: g.centroid.toArray(),
        offset: g.explosionOffset.toArray(),
        boxSize: g.worldBox.getSize(new THREE.Vector3()).toArray(),
      });
    }
    return info;
  }

  /**
   * 释放资源
   */
  dispose() {
    this.stopAutoPlay();
    this.groups.clear();
  }
}
