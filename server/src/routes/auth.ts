import { Router } from 'express';
import { AuthService } from '../auth';
import { Database } from '../database';
import { createAuthMiddleware, AuthenticatedRequest } from '../middleware';
import { ApiResponse, LoginRequest } from '../types';

export function createAuthRoutes(authService: AuthService, database: Database) {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  // Generate login challenge
  router.post('/challenge', async (req, res): Promise<void> => {
    try {
      const { address } = req.body;
      
      if (!address) {
        res.status(400).json({
          success: false,
          error: 'Address is required'
        });
        return; // 明确返回
      }

      const challenge = authService.generateChallenge(address);

      res.json({
        success: true,
        data: {
          challenge: challenge.challenge,
          message: challenge.message
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate challenge'
      });
    }
  });

  // Verify login and get token
  router.post('/login', async (req, res): Promise<void> => {
    try {
      const loginRequest: LoginRequest = req.body;
      
      if (!loginRequest.address || !loginRequest.signature || !loginRequest.challenge) {
        res.status(400).json({
          success: false,
          error: 'Address, signature, and challenge are required'
        });
        return; // 明确返回
      }

      const authToken = await authService.verifyLogin(loginRequest);
      
      if (!authToken) {
        res.status(401).json({
          success: false,
          error: 'Authentication failed'
        });
        return; // 明确返回
      }

      // Update or create user in database
      let user = await database.getUser(loginRequest.address);
      if (user) {
        user = await database.updateUserLogin(loginRequest.address);
      } else {
        user = await database.createUser(loginRequest.address);
      }

      res.json({
        success: true,
        data: {
          token: authToken.token,
          expiresAt: authToken.expiresAt,
          user
        }
      });
    } catch (error: any) {
      res.status(401).json({
        success: false,
        error: error.message || 'Authentication failed'
      });
    }
  });

  // Get current user profile
  router.get('/profile', authMiddleware, async (req: AuthenticatedRequest, res): Promise<void> => {
    try {
      const user = await database.getUser(req.user!.address);
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
        return; // 明确返回
      }

      res.json({
        success: true,
        data: user
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get user profile'
      });
    }
  });

  // Verify token endpoint
  router.get('/verify', authMiddleware, (req: AuthenticatedRequest, res): void => {
    res.json({
      success: true,
      data: {
        address: req.user!.address,
        loginTime: req.user!.loginTime
      }
    });
  });

  return router;
}
