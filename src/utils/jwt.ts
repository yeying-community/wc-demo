export class JWTManager {
  private secret: Uint8Array;

  constructor(secretKey: string = 'your-secret-key') {
    // 将字符串转换为 Uint8Array
    this.secret = new TextEncoder().encode(secretKey);
  }

  async generateToken(address: string, sessionId: string): Promise<string> {
    const payload: jose.JWTPayload = {
      iss: address,
      sub: sessionId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };

    try {
      // 使用 HS256 算法签名
      const jwt = await new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(this.secret);

      return jwt;
    } catch (error) {
      console.error('JWT 生成失败:', error);
      throw new Error('JWT generation failed');
    }
  }

  async verifyToken(token: string): Promise<jose.JWTPayload> {
    try {
      const { payload } = await jose.jwtVerify(token, this.secret);
      return payload as jose.JWTPayload;
    } catch (error) {
      console.error('JWT 验证失败:', error);
      throw new Error('JWT verification failed');
    }
  }

  async refreshToken(token: string): Promise<string> {
    try {
      const payload = await this.verifyToken(token);
      
      // 创建新的 token，保持相同的 address 和 sessionId
      return await this.generateToken(payload.iss as string, payload.sessionId as string);
    } catch (error) {
      console.error('JWT 刷新失败:', error);
      throw new Error('JWT refresh failed');
    }
  }
}