const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 格式化时间
function formatToISO(date) {
  return date.toISOString().split('.')[0].replace('T', ' ');
}

// 延时函数
async function delayTime(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 读取账号信息
let accounts;
try {
  const jsonStr = process.env.ACCOUNTS_JSON;
  if (!jsonStr) throw new Error('未检测到环境变量 ACCOUNTS_JSON');
  accounts = JSON.parse(jsonStr);
} catch (err) {
  console.error('❌ 无法解析 ACCOUNTS_JSON：', err.message);
  process.exit(1);
}

// 日志文件路径
const LOG_FILE = path.resolve(__dirname, 'logs.json');

// 读取已有日志
let logs = [];
if (fs.existsSync(LOG_FILE)) {
  try {
    logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch (_) { logs = []; }
}

(async () => {
  console.log(`检测到 ${accounts.length} 个账号，将依次登录...`);

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const account of accounts) {
    const { username, password, panelnum } = account;
    let page;
    let logEntry = {
      username,
      panelnum,
      timestampUTC: formatToISO(new Date()),
      timestampBeijing: formatToISO(new Date(Date.now() + 8 * 60 * 60 * 1000)),
      status: '未知'
    };

    try {
      page = await browser.newPage();
      const url = `https://panel${panelnum}.serv00.com/login/?next=/`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      await page.waitForSelector('input[type="text"], input[name="username"]', { visible: true });
      await page.waitForSelector('input[type="password"], input[name="password"]', { visible: true });

      const usernameInput = await page.$('input[type="text"], input[name="username"]');
      const passwordInput = await page.$('input[type="password"], input[name="password"]');
      const submitButton = await page.$('button[type="submit"], input[type="submit"]');

      if (!usernameInput || !passwordInput || !submitButton) {
        console.error(`❌ 账号 ${username} 登录表单未找到`);
        logEntry.status = '表单未找到';
        logs.push(logEntry);
        continue;
      }

      await usernameInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      await usernameInput.type(username, { delay: 50 });
      await passwordInput.type(password, { delay: 50 });

      await Promise.all([
        page.keyboard.press('Enter'),
        waitForLoginResult(page)
      ]);

      const isLoggedIn = await page.evaluate(() => {
        const logout = document.querySelector('a[href="/logout/"], a.logout, button.logout');
        return !!logout;
      });

      if (isLoggedIn) {
        console.log(`✅ 账号 ${username} 登录成功！`);
        logEntry.status = '成功';
      } else {
        console.error(`❌ 账号 ${username} 登录失败`);
        logEntry.status = '失败';
      }

    } catch (error) {
      console.error(`⚠️ 账号 ${username} 登录出现错误: ${error.message}`);
      logEntry.status = `错误: ${error.message}`;
    } finally {
      logs.push(logEntry);
      if (page && !page.isClosed()) await page.close();
      await delayTime(Math.floor(Math.random() * 8000) + 1000);
    }
  }

  await browser.close();

  // 写入日志文件
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf-8');
    console.log(`📄 日志已更新到 ${LOG_FILE}`);
  } catch (err) {
    console.error('❌ 写入日志失败：', err.message);
  }

  console.log('🎉 所有账号登录完成！');
})();

// 等待登录结果函数
function waitForLoginResult(page, opts = {}) {
  const timeout = opts.timeout || 8000;
  const logoutSelectors = ['a[href="/logout/"]', 'a.logout', 'button.logout'];

  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve();
    }, timeout);

    page.waitForNavigation({ timeout, waitUntil: 'domcontentloaded' })
      .then(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } })
      .catch(() => {});

    for (const sel of logoutSelectors) {
      page.waitForSelector(sel, { timeout })
        .then(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } })
        .catch(() => {});
    }
  });
}