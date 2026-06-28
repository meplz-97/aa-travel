# 🧳 AA 旅行记账

一个轻量级的旅行 AA 记账小程序，支持多人多设备实时同步。

## 功能

- ✈️ 创建多个行程，按时间组织
- 👥 输入名字即可加入，无需注册
- 💰 记录花费：金额、类别、谁付的、谁参与分摊
- 💱 支持多币种，自动按实时汇率换算为人民币
- 🧮 一键结算：自动计算谁该转谁多少钱
- 🔄 多设备 5 秒轮询同步
- 📱 手机浏览器打开即用，可添加到主屏幕

## 本地运行

```bash
npm install
node server.js
# 打开 http://localhost:3000
```

## 部署到 Render（免费）

### 第一步：注册 GitHub

1. 打开 [github.com](https://github.com) 注册账号
2. 验证邮箱后登录

### 第二步：上传代码

1. 在 GitHub 首页点击右上角 **+** → **New repository**
2. Repository name 填 `aa-travel`，选择 **Public**，点 **Create repository**
3. 在电脑终端执行：

```bash
cd aa-travel
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/aa-travel.git
git push -u origin main
```

### 第三步：部署到 Render

1. 打开 [render.com](https://render.com) → 点 **Get Started**
2. 选择 **用 GitHub 登录**
3. 登录后点右上角 **New** → **Web Service**
4. 在列表中找到 `aa-travel` 仓库，点 **Connect**
5. 填写配置：
   - **Name**: `aa-travel`（随意）
   - **Runtime**: Node（自动识别）
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Free Instance**: 选 Free
6. 点 **Deploy Web Service**
7. 等 1-2 分钟，部署完成会显示 `https://aa-travel-xxxx.onrender.com`
8. 点这个链接就能用了！

### 第四步：分享给朋友

把链接发到旅行群里，大家打开浏览器就能：
1. 看到行程列表
2. 点「加入」输入自己名字
3. 点「记一笔」开始记账
4. 点「看结算」看谁该转谁多少钱

> ⚠️ Render 免费套餐：15 分钟无访问会自动休眠，下次访问需等 30-60 秒唤醒。对旅行场景影响不大（时不时有人记账就会保持活跃）。

## 分类说明

| 分类 | 图标 | 示例 |
|------|------|------|
| 餐饮 | 🍔 | 午餐、晚餐、小吃 |
| 交通 | 🚌 | 打车、地铁、租车 |
| 住宿 | 🏨 | 酒店、民宿 |
| 门票 | 🎫 | 景点门票、活动 |
| 购物 | 🛍 | 纪念品、日用品 |
| 其他 | 📦 | 未分类花费 |

## 支持货币

人民币(CNY)、美元(USD)、欧元(EUR)、日元(JPY)、韩元(KRW)、泰铢(THB)、港币(HKD)、新台币(TWD)、新加坡元(SGD)、马来西亚令吉(MYR)、越南盾(VND)、印尼盾(IDR)、菲律宾比索(PHP)、英镑(GBP)、澳元(AUD)、加元(CAD)

汇率每小时自动更新，来源：[Frankfurter API](https://www.frankfurter.app/)（欧洲央行数据）

## 技术栈

- 前端：HTML + CSS + 原生 JS（零框架）
- 后端：Node.js + Express
- 数据库：SQLite
- 部署：[Render.com](https://render.com) 免费套餐
