# 🏗️ 建筑模型 3D 游览系统

扫描二维码，即可在手机/电脑上自由探索你的 SketchUp 建筑模型。支持 **PBR 真实感渲染**、**爆炸视图**、**滚动导览**和**自由视角**。

---

## 🚀 部署（三步）

你的模型文件 103MB，超过 GitHub Pages 的 100MB 限制，需要用 **GitHub Releases** 来托管模型文件。

### 第一步：创建 GitHub 仓库

1. 在 [GitHub](https://github.com) 创建一个**公开仓库**（例如 `building-viewer`）
2. **不要**勾选 "Add a README file"

### 第二步：上传代码（不含模型）

在终端中：

```bash
cd model-viewer

# 删除 assets 中的 GLB（我们先上传代码）
rm assets/model.glb

git init
git add .
git commit -m "建筑模型游览系统"
git branch -M main
git remote add origin https://github.com/你的用户名/building-viewer.git
git push -u origin main
```

### 第三步：上传模型到 Release

1. 在 GitHub 仓库页面 → **Releases** → **Create a new release**
2. Tag: `v1.0`，标题: `建筑模型`
3. 点击 **Attach binaries**，选择 `assets/model.glb`（103MB）
4. 点击 **Publish release**
5. 发布后，右键点击 `model.glb` 链接 → 复制链接地址

> GitHub Releases 支持最大 2GB 的单文件，完全没问题。

### 第四步：配置并启用 Pages

1. 编辑 `js/main.js`，找到第 8 行附近的 `CLOUD_MODEL_URL`，把值改成你复制的 Release 链接
2. 提交这个修改：`git add js/main.js && git commit -m "配置模型URL" && git push`
3. 在仓库页面：**Settings → Pages**
4. Source 选 **Deploy from a branch**，分支 `main`，文件夹 `/ (root)`，保存
5. 等待约 1 分钟，网站地址：`https://你的用户名.github.io/building-viewer`

### 第五步：分享

打开你的网站，点击右下角 **QR** 按钮，扫描二维码即可在手机上体验。

---

## 🎮 操作说明

### 桌面端

| 操作 | 效果 |
|------|------|
| 滚动鼠标 | 导览模式 — 自动切换视角 |
| 点击「自由视角」 | 进入自由探索模式 |
| 拖拽鼠标 | 旋转模型 |
| 滚轮 | 缩放 |
| 右键拖拽 | 平移 |
| 拖动爆炸滑块 | 控制部件分离程度 |
| 点击 ▶ 按钮 | 自动播放爆炸动画 |
| 键盘 `F` | 切换导览/自由模式 |
| 键盘 `E` | 切换爆炸动画 |
| 键盘 `1-6` | 跳转到各个视角 |

### 手机端

| 操作 | 效果 |
|------|------|
| 滑动页面 | 导览模式 — 自动切换视角 |
| 点击「自由视角」 | 进入自由探索模式 |
| 单指滑动 | 旋转模型 |
| 双指捏合 | 缩放 |
| 双指滑动 | 平移 |

---

## 📁 文件结构

```
model-viewer/
├── index.html              # 主页面
├── css/
│   └── style.css           # 全部样式
├── js/
│   ├── main.js             # 应用入口、滚动导览、UI 交互、QR 码
│   ├── viewer.js           # Three.js 渲染引擎（PBR、光照、阴影）
│   └── explode.js          # 爆炸视图引擎（场景分析、动画）
├── assets/
│   └── model.glb           # ← 模型文件（通过 GitHub Release 托管）
├── start-server.bat        # Windows 一键启动本地服务器
└── README.md
```

---

## 🎨 自定义配置

### 修改导览视角

编辑 `js/main.js` 中的 `tourStops` 数组：

```javascript
{
  id: 'my-view',
  progress: 0.5,              // 在滚动进度的 50% 位置
  cameraPosition: [5, 3, 8],  // 相机位置 X, Y, Z
  cameraLookAt: [0, 1.5, 0],  // 注视点 X, Y, Z
  explodeAmount: 0.5,         // 爆炸强度 0-1
  annotation: '我的视角',      // 标注文字
  annotationPos: [0, 3, 0],   // 标注 3D 位置
}
```

### 更换环境贴图（更真实的光照）

1. 准备一张 `.hdr` 格式的等距柱状全景图
2. 放入 `assets/` 文件夹
3. 在 `js/main.js` 的 `init()` 函数中调用：
   ```javascript
   await viewer.loadEnvironment('assets/your-env.hdr');
   ```

---

## 🔧 本地开发

在电脑上预览：

```bash
# 双击 start-server.bat（Windows）
# 或在 model-viewer 目录下：
npx serve .

# 浏览器打开 http://localhost:8080
```

> 不能直接双击打开 `index.html`，因为 ES Module 需要 HTTP 服务器。

---

## 🔄 模型转换（给开发者）

如果你也需要从 SketchUp 导出模型，这是完整的转换流程：

1. **SketchUp 导出 COLLADA**：文件 → 导出 → 3D 模型 → COLLADA (.dae)
   - 选项：✅ 导出组件层级 ✅ 导出贴图 ✅ 三角化所有面
2. **COLLADA → GLB**：使用 COLLADA2GLTF 转换
3. **压缩优化**：gltf-transform (weld + dedup + quantize)

详细脚本在 `.tmp/` 目录中。

---

## ❓ 常见问题

### Q: 爆炸视图不工作？
A: 确保 SketchUp 导出时勾选了「导出组件层级」。模型有 224 个可分离组件。

### Q: 手机加载慢？
A: 103MB 模型需要较好的网络。建议在 WiFi 下打开。首次加载后浏览器会缓存。

### Q: 二维码扫不出来？
A: 确保网站已部署到公网（GitHub Pages）且 URL 正确。本地 `localhost` 地址无法被其他设备访问。

### Q: 怎么替换页面文字？
A: 编辑 `index.html`，搜索 `tour-section`，修改其中的 `<h2>` 和 `<p>` 内容。

---

## 📄 许可

MIT License — 自由使用和修改
