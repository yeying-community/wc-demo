import { DApp } from './dapp';
import { RelayConfig, SessionNamespaces } from 'walletconnect-waku-sdk';
import './style.css';

let dapp: DApp;

/**
 * 初始化 DApp
 */
async function initializeDApp() {
  try {
    // 创建 Waku Relay
    const relayConfig: RelayConfig = {
      connectionTimeout: 5000,
      clusterId: import.meta.env.VITE_CLUSTER_ID ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432,
      bootstrapPeers: import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [],
      protocol: "waku",
    };

    // 定义所需的命名空间
    const requiredNamespaces: SessionNamespaces = {
      eip155: {
        chains: ['eip155:1', 'eip155:137'], // Ethereum 和 Polygon
        methods: [
          'eth_sendTransaction',
          'personal_sign',
          'eth_signTypedData_v4'
        ],
        events: ['chainChanged', 'accountsChanged']
      }
    };

    // 定义可选的命名空间
    const optionalNamespaces: SessionNamespaces = {
      eip155: {
        chains: ['eip155:56', 'eip155:42161'], // BSC 和 Arbitrum
        methods: [
          'eth_signTransaction',
          'wallet_switchEthereumChain',
          'wallet_addEthereumChain'
        ],
        events: []
      }
    };

    // 创建 DApp 实例
    dapp = new DApp({
      relayConfig,
      metadata: {
        name: 'WalletConnect Waku DApp',
        description: 'A sample DApp using WalletConnect over Waku',
        url: 'https://walletconnect-waku.example.com',
        icons: ['https://walletconnect-waku.example.com/icon.png']
      },
      requiredNamespaces,
      optionalNamespaces,
      requestTimeout: 60000 // 60 秒超时
    });

    // 初始化
    await dapp.initialize();
    console.log('[Main] DApp initialized successfully');
  } catch (error) {
    console.error('[Main] Failed to initialize DApp:', error);
    showToast('Failed to initialize DApp. Please refresh the page.', 'error');
  }
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
  // ==================== 连接按钮 ====================
  const connectButton = document.getElementById('connect-button');
  if (connectButton) {
    connectButton.addEventListener('click', async () => {
      try {
        await dapp.createConnection();
      } catch (error) {
        console.error('[Main] Connection failed:', error);
        showToast('Failed to create connection', 'error');
      }
    });
  }

  // ==================== 断开连接按钮 ====================
  const disconnectButton = document.getElementById('disconnect-button');
  if (disconnectButton) {
    disconnectButton.addEventListener('click', async () => {
      try {
        await dapp.disconnect();
      } catch (error) {
        console.error('[Main] Disconnect failed:', error);
        showToast('Failed to disconnect', 'error');
      }
    });
  }

  // ==================== 发送交易按钮 ====================
  const sendTxButton = document.getElementById('send-tx-button');
  if (sendTxButton) {
    sendTxButton.addEventListener('click', async () => {
      const toAddress = (document.getElementById('to-address') as HTMLInputElement)?.value;
      const amount = (document.getElementById('amount') as HTMLInputElement)?.value;

      if (!toAddress || !amount) {
        showToast('Please enter recipient address and amount', 'info');
        return;
      }

      // 验证地址格式
      if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
        showToast('Invalid Ethereum address', 'error');
        return;
      }

      try {
        // 将 ETH 转换为 Wei (16进制)
        const valueInWei = '0x' + (parseFloat(amount) * 1e18).toString(16);

        const txHash = await dapp.sendTransaction({
          to: toAddress,
          value: valueInWei
        });

        showToast(`Transaction sent!\n\nHash: ${txHash}`, 'info');

        // 清空输入框
        (document.getElementById('to-address') as HTMLInputElement).value = '';
        (document.getElementById('amount') as HTMLInputElement).value = '';
      } catch (error: any) {
        console.error('[Main] Transaction failed:', error);
        showToast(`Transaction failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 签名消息按钮 ====================
  const signButton = document.getElementById('sign-button');
  if (signButton) {
    signButton.addEventListener('click', async () => {
      const message = (document.getElementById('message-input') as HTMLInputElement)?.value;

      if (!message) {
        showToast('Please enter a message to sign', 'info');
        return;
      }

      try {
        const signature = await dapp.signMessage(message);

        const resultDiv = document.getElementById('sign-result');
        if (resultDiv) {
          resultDiv.innerHTML = `
            <h4>Sign Result</h4>
            <div class="info-item">
              <span class="info-label">Message:</span>
              <span class="info-value">${message}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Signature:</span>
              <span class="info-value">${signature}</span>
            </div>
          `;
          resultDiv.style.display = 'block';
        }

        // 清空输入框
        (document.getElementById('message-input') as HTMLInputElement).value = '';
      } catch (error: any) {
        console.error('[Main] Sign failed:', error);
        showToast(`Sign failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 签名类型化数据按钮 ====================
  const signTypedDataButton = document.getElementById('sign-typed-data-button');
  if (signTypedDataButton) {
    signTypedDataButton.addEventListener('click', async () => {
      // EIP-712 类型化数据示例
      const typedData = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' }
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' }
          ]
        },
        primaryType: 'Mail',
        domain: {
          name: 'Ether Mail',
          version: '1',
          chainId: 1,
          verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
        },
        message: {
          from: {
            name: 'Alice',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
          },
          to: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
          },
          contents: 'Hello, Bob!'
        }
      };

      try {
        const signature = await dapp.signTypedData(typedData);

        const resultDiv = document.getElementById('typed-data-result');
        if (resultDiv) {
          resultDiv.innerHTML = `
            <h4>Typed Data Sign Result</h4>
            <div class="info-item">
              <span class="info-label">Typed Data:</span>
            </div>
            <pre>${JSON.stringify(typedData, null, 2)}</pre>
            <div class="info-item">
              <span class="info-label">Signature:</span>
              <span class="info-value">${signature}</span>
            </div>
          `;
          resultDiv.style.display = 'block';
        }
      } catch (error: any) {
        console.error('[Main] Sign typed data failed:', error);
        showToast(`Sign typed data failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 切换链按钮 ====================
  const switchChainButton = document.getElementById('switch-chain-button');
  if (switchChainButton) {
    switchChainButton.addEventListener('click', async () => {
      const chainSelect = document.getElementById('chain-select') as HTMLSelectElement;
      const chainId = chainSelect?.value;

      if (!chainId) {
        showToast('Please select a chain', 'info');
        return;
      }

      try {
        await dapp.switchChain(chainId);
        showToast(`Switched to chain ${chainId}`, 'success');
      } catch (error: any) {
        console.error('[Main] Switch chain failed:', error);
        showToast(`Switch chain failed: ${error.message}`, 'error');
      }
    });
  }

// ==================== 添加链按钮 ====================
  const addChainButton = document.getElementById('add-chain-button');
  if (addChainButton) {
    addChainButton.addEventListener('click', async () => {
      // Polygon Mumbai 测试网示例
      const chainParams = {
        chainId: '0x13881',
        chainName: 'Polygon Mumbai',
        nativeCurrency: {
          name: 'MATIC',
          symbol: 'MATIC',
          decimals: 18
        },
        rpcUrls: ['https://rpc-mumbai.maticvigil.com'],
        blockExplorerUrls: ['https://mumbai.polygonscan.com']
      };

      try {
        await dapp.addChain(chainParams);
        showToast(`Chain ${chainParams.chainName} added successfully`, 'success');
      } catch (error: any) {
        console.error('[Main] Add chain failed:', error);
        showToast(`Add chain failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== Ping 按钮 ====================
  const pingButton = document.getElementById('ping-button');
  if (pingButton) {
    pingButton.addEventListener('click', async () => {
      try {
        await dapp.ping();
        showToast('Ping successful!', 'success');
      } catch (error: any) {
        console.error('[Main] Ping failed:', error);
        showToast(`Ping failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 获取会话信息按钮 ====================
  const getSessionButton = document.getElementById('get-session-button');
  if (getSessionButton) {
    getSessionButton.addEventListener('click', () => {
      const session = dapp.getSession();
      const sessionInfo = document.getElementById('session-info');

      if (sessionInfo) {
        if (session) {
          sessionInfo.innerHTML = `
            <h4>Session Information</h4>
            <pre>${JSON.stringify(session, null, 2)}</pre>
          `;
        } else {
          sessionInfo.innerHTML = '<p>No active session</p>';
        }
        sessionInfo.style.display = 'block';
      }
    });
  }

  // ==================== 获取账户信息按钮 ====================
  const getAccountsButton = document.getElementById('get-accounts-button');
  if (getAccountsButton) {
    getAccountsButton.addEventListener('click', () => {
      const accounts = dapp.getAccounts();
      const chains = dapp.getChains();
      const methods = dapp.getMethods();

      const accountsInfo = document.getElementById('accounts-info');
      if (accountsInfo) {
        accountsInfo.innerHTML = `
          <h4>Account Information</h4>
          <div class="info-item">
            <span class="info-label">Accounts:</span>
          </div>
          <pre>${JSON.stringify(accounts, null, 2)}</pre>
          <div class="info-item">
            <span class="info-label">Chains:</span>
          </div>
          <pre>${JSON.stringify(chains, null, 2)}</pre>
          <div class="info-item">
            <span class="info-label">Methods:</span>
          </div>
          <pre>${JSON.stringify(methods, null, 2)}</pre>
        `;
        accountsInfo.style.display = 'block';
      }
    });
  }

  // ==================== 复制 URI 按钮 ====================
  const copyUriButton = document.getElementById('copy-uri-button');
  if (copyUriButton) {
    copyUriButton.addEventListener('click', () => {
      const uriText = document.getElementById('uri-text');
      if (uriText && uriText.textContent) {
        navigator.clipboard.writeText(uriText.textContent)
          .then(() => {
            showToast('URI copied to clipboard!');
          })
          .catch(err => {
            console.error('[Main] Failed to copy URI:', err);
            showToast('Failed to copy URI', 'error');
          });
      }
    });
  }

  // ==================== 刷新状态按钮 ====================
  const refreshStatusButton = document.getElementById('refresh-status-button');
  if (refreshStatusButton) {
    refreshStatusButton.addEventListener('click', () => {
      const isConnected = dapp.isConnected();
      const statusElement = document.getElementById('connection-status');

      if (statusElement) {
        statusElement.textContent = isConnected ? 'Connected' : 'Disconnected';
        statusElement.className = isConnected ? 'status success' : 'status error';
      }

      if (isConnected) {
        const accounts = dapp.getAccounts();
        const chains = dapp.getChains();
        showToast(`Status: Connected\nAccounts: ${accounts.length}\nChains: ${chains.length}`);
      } else {
        showToast('Status: Disconnected', 'info');
      }
    });
  }

  // ==================== 登录按钮 ====================
  const loginButton = document.getElementById('login-button');
  if (loginButton) {
    loginButton.addEventListener('click', async () => {
      try {
        if (!dapp.isConnected()) {
          showToast('Please connect wallet first', 'info');
          return;
        }

        await dapp.login();
        showToast('Login successful!', 'success');
      } catch (error: any) {
        console.error('[Main] Login failed:', error);
        showToast(`Login failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 登出按钮 ====================
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => {
      try {
        dapp.getAuthService().logout();

        // 隐藏认证信息
        const authInfo = document.getElementById('auth-info');
        if (authInfo) {
          authInfo.style.display = 'none';
        }

        const protectedSection = document.getElementById('protected-section');
        if (protectedSection) {
          protectedSection.style.display = 'none';
        }

        showToast('Logged out successfully', 'success');
      } catch (error: any) {
        console.error('[Main] Logout failed:', error);
        showToast(`Logout failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 获取用户资料按钮 ====================
  const getProfileButton = document.getElementById('get-profile-button');
  if (getProfileButton) {
    getProfileButton.addEventListener('click', async () => {
      try {
        if (!dapp.isAuthenticated()) {
          showToast('Please login first', 'info');
          return;
        }

        const profile = await dapp.getAuthService().getUserProfile();
        
        const profileInfo = document.getElementById('profile-info');
        if (profileInfo) {
          profileInfo.innerHTML = `
            <h4>User Profile</h4>
            <pre>${JSON.stringify(profile, null, 2)}</pre>
          `;
          profileInfo.style.display = 'block';
        }

        showToast('Profile loaded successfully', 'success');
      } catch (error: any) {
        console.error('[Main] Failed to get profile:', error);
        showToast(`Failed to get profile: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 调用受保护 API 按钮 ====================
  const callProtectedApiButton = document.getElementById('call-protected-api-button');
  if (callProtectedApiButton) {
    callProtectedApiButton.addEventListener('click', async () => {
      try {
        if (!dapp.isAuthenticated()) {
          showToast('Please login first', 'info');
          return;
        }

        // 示例：调用受保护的 API
        const data = await dapp.getAuthService().callProtectedAPI('/api/protected/data');
        
        const apiResult = document.getElementById('api-result');
        if (apiResult) {
          apiResult.innerHTML = `
            <h4>Protected API Result</h4>
            <pre>${JSON.stringify(data, null, 2)}</pre>
          `;
          apiResult.style.display = 'block';
        }

        showToast('API call successful', 'success');
      } catch (error: any) {
        console.error('[Main] API call failed:', error);
        showToast(`API call failed: ${error.message}`, 'error');
      }
    });
  }

 // ==================== 验证 Token 按钮 ====================
  const verifyTokenButton = document.getElementById('verify-token-button');
  if (verifyTokenButton) {
    verifyTokenButton.addEventListener('click', async () => {
      try {
        if (!dapp.isAuthenticated()) {
          showToast('No active session', 'info');
          return;
        }

        const isValid = await dapp.getAuthService().verifyToken();
        
        if (isValid) {
          showToast('Token is valid ✓', 'success');
        } else {
          showToast('Token is invalid or expired', 'error');
          dapp.getAuthService().logout();
        }
      } catch (error: any) {
        console.error('[Main] Token verification failed:', error);
        showToast(`Verification failed: ${error.message}`, 'error');
      }
    });
  }

  // ==================== 刷新认证状态按钮 ====================
  const refreshAuthButton = document.getElementById('refresh-auth-button');
  if (refreshAuthButton) {
    refreshAuthButton.addEventListener('click', async () => {
      try {
        const isAuthenticated = dapp.isAuthenticated();
        const authSession = dapp.getAuthService().getSession();

        const authStatusDiv = document.getElementById('auth-status-display');
        if (authStatusDiv) {
          if (isAuthenticated && authSession) {
            const expiresIn = Math.floor((authSession.expiresAt - Date.now()) / 1000 / 60);
            authStatusDiv.innerHTML = `
              <h4>Authentication Status</h4>
              <div class="info-item">
                <span class="info-label">Status:</span>
                <span class="info-value" style="color: #28a745;">✓ Authenticated</span>
              </div>
              <div class="info-item">
                <span class="info-label">Address:</span>
                <span class="info-value">${authSession.address}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Token Expires In:</span>
                <span class="info-value">${expiresIn} minutes</span>
              </div>
            `;
          } else {
            authStatusDiv.innerHTML = `
              <h4>Authentication Status</h4>
              <p style="color: #dc3545;">✕ Not Authenticated</p>
            `;
          }
          authStatusDiv.style.display = 'block';
        }

        showToast(isAuthenticated ? 'Authenticated' : 'Not authenticated', 
                  isAuthenticated ? 'success' : 'info');
      } catch (error: any) {
        console.error('[Main] Failed to refresh auth status:', error);
        showToast(`Failed to refresh: ${error.message}`, 'error');
      }
    });
  }
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6'
  };
  
  const toast = document.createElement('div');
  toast.innerHTML = `
    <span style="margin-right: 8px; font-size: 16px;">${icons[type]}</span>
    <span>${message}</span>
  `;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type]};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    display: flex;
    align-items: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    opacity: 0;
    transform: translateX(100px);
    transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  `;
  
  document.body.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ==================== 页面加载完成后初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Main] DOM loaded, initializing...');
  
  try {
    await initializeDApp();
    setupEventListeners();
    console.log('[Main] Setup complete');
  } catch (error) {
    console.error('[Main] Setup failed:', error);
  }
});

// ==================== 页面卸载时清理 ====================
window.addEventListener('beforeunload', async () => {
  if (dapp) {
    try {
      await dapp.destroy();
    } catch (error) {
      console.error('[Main] Cleanup failed:', error);
    }
  }
});
