import { Wallet } from './wallet';

let wallet: Wallet;

async function initializeWallet() {
  try {
    // 生成一个示例地址和私钥，或者从本地存储加载
    const savedAddress = localStorage.getItem('wallet-address');
    const savedPrivateKey = localStorage.getItem('wallet-private-key');
    let address: string;
    let privateKey: string;
    
    if (savedAddress && savedPrivateKey) {
      address = savedAddress;
      privateKey = savedPrivateKey;
    } else {
      // 生成新的钱包
      address = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
      privateKey = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      
      // 保存到本地存储
      localStorage.setItem('wallet-address', address);
      localStorage.setItem('wallet-private-key', privateKey);
    }
    
    wallet = new Wallet(address, privateKey);
    await wallet.initialize();
    
    // 将 wallet 实例添加到全局 window 对象，供 HTML 中的 onclick 处理器使用
    (window as any).wallet = wallet;

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
  if (addressElement) {
    addressElement.textContent = wallet.address;
  }
  
  // 更新连接数量
  const connectionsElement = document.getElementById('connections-count');
  if (connectionsElement) {
    connectionsElement.textContent = wallet.getConnections().length.toString();
  }
}

function setupEventListeners() {
  // 清除历史记录
  const clearHistoryBtn = document.getElementById('clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all authentication history?')) {
        localStorage.removeItem(`auth-history-${wallet.address}`);
        wallet.updateAuthHistoryUI();
        wallet.showNotification('Authentication history cleared', 'info');
      }
    });
  }

  // 导出钱包数据
  const exportBtn = document.getElementById('export-wallet');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const walletData = {
        address: wallet.address,
        authHistory: wallet.getAuthHistory(),
        connections: wallet.getConnections(),
        exportTime: new Date().toISOString()
      };

      const blob = new Blob([JSON.stringify(walletData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-${wallet.address.slice(0, 8)}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      wallet.showNotification('Wallet data exported', 'success');
    });
  }

  // 设置项监听器
  const autoApproveCheckbox = document.getElementById('auto-approve-known') as HTMLInputElement;
  if (autoApproveCheckbox) {
    autoApproveCheckbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      localStorage.setItem('auto-approve-known', target.checked.toString());
    });

    // 加载保存的设置
    const saved = localStorage.getItem('auto-approve-known');
    if (saved) {
      autoApproveCheckbox.checked = saved === 'true';
    }
  }

  const notificationsCheckbox = document.getElementById('show-notifications') as HTMLInputElement;
  if (notificationsCheckbox) {
    notificationsCheckbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      localStorage.setItem('show-notifications', target.checked.toString());
    });

    // 加载保存的设置
    const saved = localStorage.getItem('show-notifications');
    if (saved !== null) {
      notificationsCheckbox.checked = saved === 'true';
    } else {
      // 默认启用通知
      notificationsCheckbox.checked = true;
      localStorage.setItem('show-notifications', 'true');
    }
  }

  // 复制地址按钮
  const copyAddressBtn = document.getElementById('copy-address');
  if (copyAddressBtn) {
    copyAddressBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(wallet.address);
        wallet.showNotification('Address copied to clipboard', 'success');
      } catch (error) {
        console.error('Failed to copy address:', error);
        wallet.showNotification('Failed to copy address', 'error');
      }
    });
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      
      if (!tabId) return;

      // 移除所有活动状态
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // 激活当前标签
      tab.classList.add('active');
      const targetContent = document.getElementById(tabId);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      // 如果切换到历史标签，更新历史显示
      if (tabId === 'history') {
        wallet.updateAuthHistoryUI();
      }
      
      // 如果切换到连接标签，更新连接显示
      if (tabId === 'connections') {
        updateConnectionsUI();
      }
    });
  });
}

function updateConnectionsUI(): void {
  const connectionsDiv = document.getElementById('active-connections');
  if (!connectionsDiv) return;

  const connections = wallet.getConnections();
  
  if (connections.length === 0) {
    connectionsDiv.innerHTML = '<p class="no-data">No active connections</p>';
    return;
  }

  const connectionsHTML = connections.map(session => `
    <div class="connection-item">
      <div class="connection-info">
        <strong>${session.metadata.name}</strong>
        <span class="connection-url">${session.metadata.url}</span>
        <span class="connection-time">Connected: ${new Date(session.createdAt).toLocaleString()}</span>
      </div>
      <div class="connection-actions">
        <button onclick="wallet.disconnect('${session.id}')" class="disconnect-btn">Disconnect</button>
      </div>
    </div>
  `).join('');

  connectionsDiv.innerHTML = connectionsHTML;
}

function updateStatus(message: string) {
  const statusElement = document.getElementById('status');
  if (statusElement) {
    statusElement.textContent = message;
  }
}

document.addEventListener('DOMContentLoaded', initializeWallet);
