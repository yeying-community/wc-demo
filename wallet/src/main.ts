import { Wallet } from './wallet';

let w: Wallet;

async function initializeWallet() {
  try {
    // 从本地存储加载或生成新钱包
    const savedAddress = localStorage.getItem('wallet-address');
    const savedPrivateKey = localStorage.getItem('wallet-private-key');

    if (savedAddress && savedPrivateKey) {
      w = new Wallet(savedAddress, savedPrivateKey);
    } else {
      // 生成新钱包
      w = new Wallet();

      // 保存到本地存储
      localStorage.setItem('wallet-address', w.address);
      localStorage.setItem('wallet-private-key', (w as any).privateKey);
    }

    await w.initialize();

    // 将 wallet 实例添加到全局 window 对象
    (window as any).wallet = w;

    setupEventListeners();
    setupTabs();
    updateWalletInfo();

    console.log('Wallet initialized successfully');
  } catch (error) {
    console.error('Failed to initialize wallet:', error);
    updateStatus('Failed to initialize wallet');
  }
}

function updateWalletInfo(): void {
  // 更新钱包地址显示
  const addressElement = document.getElementById('wallet-address');
  if (addressElement && w) {
    addressElement.textContent = w.address;
  }

  // 更新连接数
  w.updateConnectionsUI();

  // 更新认证历史
  w.updateAuthHistoryUI();
}

function setupEventListeners(): void {
  // 复制地址按钮
  const copyBtn = document.getElementById('copy-address');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (w) {
        navigator.clipboard.writeText(w.address);
        w.showNotification('Address copied to clipboard', 'success');
      }
    });
  }

  // 刷新连接按钮
  const refreshBtn = document.getElementById('refresh-connections');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (w) {
        w.updateConnectionsUI();
        w.showNotification('Connections refreshed', 'success');
      }
    });
  }

  // 清除历史按钮
  const clearHistoryBtn = document.getElementById('clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (w && confirm('Are you sure you want to clear all authentication history?')) {
        w.clearAuthHistory();
        w.showNotification('History cleared', 'success');
      }
    });
  }

  // 导出数据按钮
  const exportBtn = document.getElementById('export-data');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (w) {
        const data = w.exportWalletData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallet-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        w.showNotification('Data exported', 'success');
      }
    });
  }

  // 设置表单
  const settingsForm = document.getElementById('settings-form') as HTMLFormElement;
  if (settingsForm) {
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
    });
  }

  // 加载设置
  loadSettings();
}

function setupTabs(): void {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');

      // 移除所有活动状态
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // 添加活动状态
      button.classList.add('active');
      const targetContent = document.getElementById(`${tabName}-tab`);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // 更新对应的数据
      if (tabName === 'connections' && w) {
        w.updateConnectionsUI();
      } else if (tabName === 'history' && w) {
        w.updateAuthHistoryUI();
      }
    });
  });
}

function saveSettings(): void {
  const autoApprove = (document.getElementById('auto-approve') as HTMLInputElement)?.checked;
  const showNotifications = (document.getElementById('show-notifications') as HTMLInputElement)?.checked;

  localStorage.setItem('auto-approve-known', autoApprove ? 'true' : 'false');
  localStorage.setItem('show-notifications', showNotifications ? 'true' : 'false');

  if (w) {
    w.showNotification('Settings saved', 'success');
  }
}

function loadSettings(): void {
  const autoApprove = localStorage.getItem('auto-approve-known') === 'true';
  const showNotifications = localStorage.getItem('show-notifications') !== 'false'; // 默认开启

  const autoApproveCheckbox = document.getElementById('auto-approve') as HTMLInputElement;
  if (autoApproveCheckbox) {
    autoApproveCheckbox.checked = autoApprove;
  }

  const showNotificationsCheckbox = document.getElementById('show-notifications') as HTMLInputElement;
  if (showNotificationsCheckbox) {
    showNotificationsCheckbox.checked = showNotifications;
  }
}

function updateStatus(message: string): void {
  const statusElement = document.getElementById('wallet-status');
  if (statusElement) {
    statusElement.textContent = message;
  }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
  initializeWallet();
});

