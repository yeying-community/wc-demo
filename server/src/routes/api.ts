import { Router } from 'express';
import { Database } from '../database';
import { createAuthMiddleware, AuthenticatedRequest } from '../middleware';
import { AuthService } from '../auth';

export function createApiRoutes(authService: AuthService, database: Database) {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  // Protected endpoint example - get user data
  router.get('/user/data', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = await database.getUser(req.user!.address);
      
      res.json({
        success: true,
        data: {
          message: `Hello ${req.user!.address}!`,
          user,
          serverTime: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get user data'
      });
    }
  });

  // Protected endpoint example - update user preferences
  router.post('/user/preferences', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      // In a real app, you'd save preferences to database
      res.json({
        success: true,
        data: {
          message: 'Preferences updated successfully',
          preferences: req.body
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to update preferences'
      });
    }
  });

  // Admin endpoint - get all users (for demo)
  router.get('/admin/users', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const users = await database.getAllUsers();
      
      res.json({
        success: true,
        data: users
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to get users'
      });
    }
  });

  return router;
}
