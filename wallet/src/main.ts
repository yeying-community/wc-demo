import { Wallet } from './wallet';

let wallet: Wallet;

async function initializeWallet() {
  try {
    // 从本地存储加载或生成新钱包
    const savedPrivateKey = localStorage.getItem('wallet-private-key');

    if (savedPrivateKey) {
      wallet = new Wallet(savedPrivateKey);
    } else {
      // 生成新钱包
      wallet = new Wallet();
    }

    await wallet.initialize();

    // 将 wallet 实例添加到全局 window 对象
    (window as any).wallet = wallet;

    setupEventListeners();
    setupTabs();
    updateWalletInfo();

    console.log('[Main] Wallet initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to initialize wallet:', error);
    updateStatus('Failed to initialize wallet');
  }
}

function updateWalletInfo(): void {
  // 更新钱包地址显示
  const addressElement = document.getElementById('wallet-address');
  if (addressElement && wallet) {
    addressElement.textContent = wallet.address;
  }

  // 更新连接数
  wallet.updateConnectionsUI();

  // 更新认证历史
  wallet.updateAuthHistoryUI();
}

function setupEventListeners(): void {
  // 复制地址按钮
  const copyBtn = document.getElementById('copy-address');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (wallet) {
        navigator.clipboard.writeText(wallet.address);
        wallet.showNotification('Address copied to clipboard', 'success');
      }
    });
  }

  // 刷新连接按钮
  const refreshBtn = document.getElementById('refresh-connections');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (wallet) {
        wallet.updateConnectionsUI();
        wallet.showNotification('Connections refreshed', 'success');
      }
    });
  }

  // 清除历史按钮
  const clearHistoryBtn = document.getElementById('clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (wallet && confirm('Are you sure you want to clear all authentication history?')) {
        wallet.clearAuthHistory();
        wallet.showNotification('History cleared', 'success');
      }
    });
  }

  // 导出数据按钮
  const exportBtn = document.getElementById('export-data');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (wallet) {
        const data = wallet.exportWalletData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallet-data-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        wallet.showNotification('Data exported', 'success');
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

  // 添加配对 URI 输入（可选功能）
  setupPairingInput();
}

function setupPairingInput(): void {
  // 创建配对输入区域
  const requestsTab = document.getElementById('requests-tab');
  if (!requestsTab) return;

  const tabHeader = requestsTab.querySelector('.tab-header');
  if (!tabHeader) return;

  const pairingDiv = document.createElement('div');
  pairingDiv.className = 'pairing-input-container';
  pairingDiv.innerHTML = `
    <div class="input-group">
      <input 
        type="text" 
        id="pairing-uri" 
        placeholder="Paste WalletConnect URI here (wc:...)"
        class="pairing-input"
      />
      <button id="pair-btn" class="btn primary">
        🔗 Connect
      </button>
    </div>
  `;
 tabHeader.appendChild(pairingDiv);

  // 配对按钮事件
  const pairBtn = document.getElementById('pair-btn');
  const pairingInput = document.getElementById('pairing-uri') as HTMLInputElement;

  if (pairBtn && pairingInput) {
    pairBtn.addEventListener('click', async () => {
      const uri = pairingInput.value.trim();
      if (!uri) {
        wallet.showNotification('Please enter a valid URI', 'error');
        return;
      }

      if (!uri.startsWith('wc:')) {
        wallet.showNotification('Invalid WalletConnect URI', 'error');
        return;
      }

      try {
        pairBtn.textContent = '⏳ Connecting...';
        pairBtn.setAttribute('disabled', 'true');

        await wallet.pair(uri);
        
        pairingInput.value = '';
        wallet.showNotification('Pairing initiated', 'success');
      } catch (error: any) {
        console.error('[Main] Pairing failed:', error);
        wallet.showNotification(`Pairing failed: ${error.message}`, 'error');
      } finally {
        pairBtn.textContent = '🔗 Connect';
        pairBtn.removeAttribute('disabled');
      }
    });

    // 支持回车键配对
    pairingInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        pairBtn.click();
      }
    });
  }
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
      if (tabName === 'connections' && wallet) {
        wallet.updateConnectionsUI();
      } else if (tabName === 'history' && wallet) {
        wallet.updateAuthHistoryUI();
      }
    });
  });
}

function saveSettings(): void {
  const autoApprove = (document.getElementById('auto-approve') as HTMLInputElement)?.checked;
  const showNotifications = (document.getElementById('show-notifications') as HTMLInputElement)?.checked;

  localStorage.setItem('auto-approve-known', autoApprove ? 'true' : 'false');
  localStorage.setItem('show-notifications', showNotifications ? 'true' : 'false');

  if (wallet) {
    wallet.showNotification('Settings saved', 'success');
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

  // 显示 Bootstrap Peers
  const bootstrapPeersElement = document.getElementById('bootstrap-peers');
  if (bootstrapPeersElement) {
    const peers = import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [];
    bootstrapPeersElement.textContent = peers.length > 0 
      ? `${peers.length} peer(s)` 
      : 'Default peers';
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
  console.log('[Main] Initializing wallet application...');
  initializeWallet();
});

// 清理资源
window.addEventListener('beforeunload', async () => {
  if (wallet) {
    await wallet.destroy();
  }
});

