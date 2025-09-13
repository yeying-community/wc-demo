import { ethers } from 'ethers';

export class EthereumUtils {
  static isValidAddress(address: string): boolean {
    try {
      return ethers.isAddress(address);
    } catch {
      return false;
    }
  }

  static formatAddress(address: string): string {
    if (!this.isValidAddress(address)) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  static async getChainId(provider: ethers.Provider): Promise<number> {
    const network = await provider.getNetwork();
    return Number(network.chainId);
  }

  static getChainName(chainId: number): string {
    const chains: Record<number, string> = {
      1: 'Ethereum Mainnet',
      5: 'Goerli Testnet',
      137: 'Polygon Mainnet',
      80001: 'Polygon Mumbai'
    };
    return chains[chainId] || `Chain ${chainId}`;
  }

  static async estimateGas(
    provider: ethers.Provider,
    transaction: ethers.TransactionRequest
  ): Promise<bigint> {
    return await provider.estimateGas(transaction);
  }

  static formatEther(wei: bigint): string {
    return ethers.formatEther(wei);
  }

  static parseEther(ether: string): bigint {
    return ethers.parseEther(ether);
  }
}
