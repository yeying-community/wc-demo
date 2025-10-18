import { DApp } from './dapp';
import './style.css';

let dapp: DApp;

/**
 * 初始化 DApp
 */
async function initializeDApp() {
  try {
    const config = {
      clusterId: import.meta.env.VITE_CLUSTER_ID ? parseInt(import.meta.env.VITE_CLUSTER_ID) : 5432,
      wakuNodes: import.meta.env.VITE_WAKU_BOOTSTRAP_PEERS?.split(',') || [],
    }

    dapp = new DApp(config);
    await dapp.initialize();
    console.log('DApp initialized successfully');
  } catch (error) {
    console.error('Failed to initialize DApp:', error);
    alert('Failed to initialize DApp. Please refresh the page.');
  }
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
  // 连接按钮
  const connectButton = document.getElementById('connect-button');
  if (connectButton) {
    connectButton.addEventListener('click', async () => {
      try {
        await dapp.createConnection();
      } catch (error) {
        console.error('Connection failed:', error);
        alert('Failed to create connection');
      }
    });
  }

  // 断开连接按钮
  const disconnectButton = document.getElementById('disconnect-button');
  if (disconnectButton) {
    disconnectButton.addEventListener('click', async () => {
      try {
        await dapp.disconnect();
      } catch (error) {
        console.error('Disconnect failed:', error);
      }
    });
  }

  // 发送交易按钮
  const sendTxButton = document.getElementById('send-tx-button');
  if (sendTxButton) {
    sendTxButton.addEventListener('click', async () => {
      const toAddress = (document.getElementById('to-address') as HTMLInputElement)?.value;
      const amount = (document.getElementById('amount') as HTMLInputElement)?.value;

      if (!toAddress || !amount) {
        alert('Please enter recipient address and amount');
        return;
      }

      try {
        // 将 ETH 转换为 Wei
        const valueInWei = '0x' + (parseFloat(amount) * 1e18).toString(16);

        const txHash = await dapp.sendTransaction({
          to: toAddress,
          value: valueInWei
        });

        alert(`Transaction sent! Hash: ${txHash}`);

        // 清空输入框
        (document.getElementById('to-address') as HTMLInputElement).value = '';
        (document.getElementById('amount') as HTMLInputElement).value = '';
      } catch (error: any) {
        console.error('Transaction failed:', error);
        alert(`Transaction failed: ${error.message}`);
      }
    });
  }

  // 签名消息按钮
  const signButton = document.getElementById('sign-button');
  if (signButton) {
    signButton.addEventListener('click', async () => {
      const message = (document.getElementById('message-input') as HTMLInputElement)?.value;

      if (!message) {
        alert('Please enter a message to sign');
        return;
      }

      try {
        const signature = await dapp.signMessage(message);

        const resultDiv = document.getElementById('sign-result');
        if (resultDiv) {
          resultDiv.innerHTML = `
            <p><strong>Message:</strong> ${message}</p>
            <p><strong>Signature:</strong> ${signature}</p>
          `;
          resultDiv.style.display = 'block';
        }
      } catch (error: any) {
        console.error('Sign failed:', error);
        alert(`Sign failed: ${error.message}`);
      }
    });
  }

  // 签名类型化数据按钮
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
            <p><strong>Typed Data:</strong></p>
            <pre>${JSON.stringify(typedData, null, 2)}</pre>
            <p><strong>Signature:</strong> ${signature}</p>
          `;
          resultDiv.style.display = 'block';
        }
      } catch (error: any) {
        console.error('Sign typed data failed:', error);
        alert(`Sign typed data failed: ${error.message}`);
      }
    });
  }

  // 切换链按钮
  const switchChainButton = document.getElementById('switch-chain-button');
  if (switchChainButton) {
    switchChainButton.addEventListener('click', async () => {
      const chainSelect = document.getElementById('chain-select') as HTMLSelectElement;
      const chainId = chainSelect?.value;

      if (!chainId) {
        alert('Please select a chain');
        return;
      }

      try {
        await dapp.switchChain(chainId);
        alert(`Switched to chain ${chainId}`);
      } catch (error: any) {
        console.error('Switch chain failed:', error);
        alert(`Switch chain failed: ${error.message}`);
      }
    });
  }

  // Ping 按钮
  const pingButton = document.getElementById('ping-button');
  if (pingButton) {
    pingButton.addEventListener('click', async () => {
      try {
        await dapp.ping();
        alert('Ping successful!');
      } catch (error: any) {
        console.error('Ping failed:', error);
        alert(`Ping failed: ${error.message}`);
      }
    });
  }

  // 获取会话信息按钮
  const getSessionButton = document.getElementById('get-session-button');
  if (getSessionButton) {
    getSessionButton.addEventListener('click', () => {
      const session = dapp.getSession();
      const sessionInfo = document.getElementById('session-info');

      if (sessionInfo) {
        if (session) {
          sessionInfo.innerHTML = `
            <pre>${JSON.stringify(session, null, 2)}</pre>
          `;
        } else {
          sessionInfo.innerHTML = '<p>No active session</p>';
        }
        sessionInfo.style.display = 'block';
      }
    });
  }

  // 复制 URI 按钮
  const copyUriButton = document.getElementById('copy-uri-button');
  if (copyUriButton) {
    copyUriButton.addEventListener('click', () => {
      const uriText = document.getElementById('uri-text');
      if (uriText && uriText.textContent) {
        navigator.clipboard.writeText(uriText.textContent).then(() => {
          alert('URI copied to clipboard!');
        }).catch(err => {
          console.error('Failed to copy URI:', err);
          alert('Failed to copy URI');
        });
      }
    });
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await initializeDApp();
  setupEventListeners();
});
