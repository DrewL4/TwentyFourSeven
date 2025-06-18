# WatchTower Backend Additions for TwentyFour/Seven Integration

This document contains the exact code you need to add to your WatchTower Django backend to enable user export functionality.

## 1. Create Admin Views File

**File:** `backend/api/views/admin/admin_views.py`

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.conf import settings
import logging

User = get_user_model()
logger = logging.getLogger(__name__)

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminUser])
def export_users(request):
    """
    Export users with TV service for TwentyFour/Seven import.
    Only admin users can access this endpoint.
    
    Returns:
        JSON response with list of active TV users including:
        - id, username, email, first_name, last_name
        - tv_service status, is_active status, date_joined
    """
    try:
        logger.info(f"Admin user {request.user.username} requesting user export for TwentyFour/Seven")
        
        # Get all active users with TV service
        # Based on your existing code structure that uses is_tv_user=True
        users_with_tv = User.objects.filter(
            is_active=True,
            is_tv_user=True
        ).order_by('date_joined')
        
        logger.info(f"Found {users_with_tv.count()} active TV users for export")
        
        users_data = []
        for user in users_with_tv:
            user_data = {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'tv_service': True,  # Since we're filtering for TV users
                'movie_service': getattr(user, 'is_movie_user', False),  # If you have movie users
                'is_active': user.is_active,
                'date_joined': user.date_joined.isoformat(),
            }
            users_data.append(user_data)
        
        logger.info(f"Successfully exported {len(users_data)} TV users for TwentyFour/Seven import")
        
        return Response({
            'success': True,
            'count': len(users_data),
            'users': users_data,
            'message': f'Successfully exported {len(users_data)} TV users'
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f"Error exporting users for TwentyFour/Seven: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'error': 'Failed to export users. Please try again.',
            'details': str(e) if settings.DEBUG else None
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
@permission_classes([IsAuthenticated, IsAdminUser])
def export_stats(request):
    """
    Get statistics about exportable users.
    Useful for admins to see what would be exported before doing the actual export.
    """
    try:
        total_users = User.objects.filter(is_active=True).count()
        tv_users = User.objects.filter(is_active=True, is_tv_user=True).count()
        movie_users = User.objects.filter(is_active=True, is_movie_user=True).count() if hasattr(User, 'is_movie_user') else 0
        
        return Response({
            'success': True,
            'stats': {
                'total_active_users': total_users,
                'tv_users': tv_users,
                'movie_users': movie_users,
                'exportable_users': tv_users  # Currently only exporting TV users
            }
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f"Error getting export stats: {str(e)}", exc_info=True)
        return Response({
            'success': False,
            'error': 'Failed to get export statistics'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

## 2. Add URL Configuration

**Option A: If you have a main `api/urls.py` file, add this to it:**

```python
# Add this import at the top
from .views.admin.admin_views import export_users, export_stats

# Add these URL patterns to your existing urlpatterns list
urlpatterns = [
    # ... your existing URLs ...
    
    # TwentyFour/Seven Integration
    path('api/admin/export-users/', export_users, name='admin_export_users'),
    path('api/admin/export-stats/', export_stats, name='admin_export_stats'),
]
```

**Option B: If you prefer to create a separate admin URLs file:**

Create `backend/api/urls/admin_urls.py`:
```python
from django.urls import path
from ..views.admin.admin_views import export_users, export_stats

urlpatterns = [
    # TwentyFour/Seven Integration Endpoints
    path('export-users/', export_users, name='admin_export_users'),
    path('export-stats/', export_stats, name='admin_export_stats'),
]
```

Then include it in your main URLs file:
```python
# In your main api/urls.py or core/urls.py
from django.urls import path, include

urlpatterns = [
    # ... your existing URLs ...
    path('api/admin/', include('api.urls.admin_urls')),
]
```

## 3. Ensure Required Dependencies

Make sure your WatchTower backend has these in `requirements.txt` (you likely already have them):

```
djangorestframework>=3.14.0
django>=4.0.0
```

## 4. Update Settings (if needed)

Ensure your `settings.py` has proper logging configuration:

```python
# In your settings.py
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': 'watchtower.log',
        },
    },
    'loggers': {
        'api.views.admin.admin_views': {
            'handlers': ['file'],
            'level': 'INFO',
            'propagate': True,
        },
    },
}
```

## 5. Test the Endpoint

After adding these files and restarting your WatchTower server, you can test the endpoint:

```bash
# First login to get session
curl -X POST http://your-watchtower.com/api/login/ \
  -H "Content-Type: application/json" \
  -d '{"username": "your_admin_username", "password": "your_password"}' \
  -c cookies.txt

# Then test the export endpoint
curl -X GET http://your-watchtower.com/api/admin/export-users/ \
  -b cookies.txt
```

## 6. Security Notes

- ✅ Only admin users can access the export endpoint (`IsAdminUser` permission)
- ✅ Requires authentication (`IsAuthenticated` permission)
- ✅ Comprehensive error logging for debugging
- ✅ No sensitive data (passwords) are exported
- ✅ Proper HTTP status codes and error handling

## 7. Integration with TwentyFour/Seven

Once you've added these files to your WatchTower backend:

1. Restart your WatchTower server
2. In TwentyFour/Seven, go to `/users` page
3. Enter your WatchTower URL and admin credentials
4. Click "Sign In & Import TV Users"

The system will automatically:
- Login to WatchTower with your credentials
- Call the `/api/admin/export-users/` endpoint
- Import all users where `is_tv_user=True`
- Skip duplicates and handle errors gracefully 