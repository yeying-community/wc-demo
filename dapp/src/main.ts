import { DApp } from './dapp';

let dapp: DApp;

async function initializeDApp() {
  dapp = new DApp();
  await dapp.initialize();
}

function setupEventListeners() {
  const connectButton = document.getElementById('connect-button');
  const signButton = document.getElementById('sign-button');
  const disconnectButton = document.getElementById('disconnect-button');

  if (connectButton) {
    connectButton.addEventListener('click', async () => {
      try {
        await dapp.connect();
      } catch (error) {
        console.error('Connection failed:', error);
      }
    });
  }

  if (signButton) {
    signButton.addEventListener('click', async () => {
      const messageInput = document.getElementById('message-input') as HTMLInputElement;
      const message = messageInput?.value || 'Hello, World!';
      
      try {
        await dapp.signMessage(message);
      } catch (error) {
        console.error('Sign failed:', error);
      }
    });
  }

  if (disconnectButton) {
    disconnectButton.addEventListener('click', async () => {
      await dapp.disconnect();
    });
  }

  // 服务器认证按钮
  const serverAuthButton = document.getElementById('server-auth-button');
  if (serverAuthButton) {
    serverAuthButton.addEventListener('click', async () => {
      if (dapp.authToken) {
        await dapp.logoutFromServer();
      } else {
        try {
          await dapp.authenticateWithServer();
        } catch (error) {
          console.error('Server auth failed:', error);
        }
      }
    });
  }

  // 获取用户数据按钮
  const getUserDataButton = document.getElementById('get-user-data');
  if (getUserDataButton) {
    getUserDataButton.addEventListener('click', async () => {
      try {
        const userData = await dapp.getUserData();
        const resultDiv = document.getElementById('user-data-result');
        if (resultDiv) {
          resultDiv.innerHTML = `<pre>${JSON.stringify(userData.data, null, 2)}</pre>`;
        }
      } catch (error: any) {
        alert(`Failed to get user data: ${error.message}`);
      }
    });
  }

  // 更新偏好设置按钮
  const updatePrefsButton = document.getElementById('update-preferences');
  if (updatePrefsButton) {
    updatePrefsButton.addEventListener('click', async () => {
      try {
        const preferences = {
          theme: 'dark',
          notifications: true,
          language: 'en'
        };
        await dapp.updateUserPreferences(preferences);
        alert('Preferences updated successfully!');
      } catch (error: any) {
        alert(`Failed to update preferences: ${error.message}`);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initializeDApp();
  setupEventListeners();
});
