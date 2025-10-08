import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth';

export interface AuthenticatedRequest extends Request {
  user?: {
    address: string;
    loginTime: number;
  };
}

export function createAuthMiddleware(authService: AuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
      return; // 明确返回
    }

    const token = authHeader.substring(7);
    const user = authService.verifyToken(token);
    
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
      return; // 明确返回
    }

    req.user = user;
    next();
  };
}
