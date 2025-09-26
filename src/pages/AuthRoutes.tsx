import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AuthLanding } from '../components/auth/AuthLanding';
import { EmailPasswordLogin } from '../components/auth/EmailPasswordLogin';
import { MagicLinkRequest } from '../components/auth/MagicLinkRequest';
import { SocialRedirect } from '../components/auth/SocialRedirect';
import { MFAChallenge } from '../components/auth/MFAChallenge';
import { MFAEnrollment } from '../components/auth/MFAEnrollment';
import { ForgotPassword } from '../components/auth/ForgotPassword';
import { AccountRecovery } from '../components/auth/AccountRecovery';
import { AuthSuccess } from '../components/auth/AuthSuccess';
import { ProfileSettings } from '../components/auth/ProfileSettings';
import { AdminUserManagement } from '../components/auth/AdminUserManagement';
import { AuthAudit } from '../components/auth/AuthAudit';
import { DesignSystemGuide } from '../components/DesignSystemGuide';
import { AvatarShowcase } from '../components/AvatarShowcase';
import type { AuthScreen } from '../components/auth/types';

const SCREEN_COMPONENTS: Record<AuthScreen, React.ComponentType<{ onNavigate: (screen: AuthScreen) => void }>> = {
  landing: AuthLanding,
  login: EmailPasswordLogin,
  'magic-link': MagicLinkRequest,
  'social-redirect': SocialRedirect,
  'mfa-challenge': MFAChallenge,
  'mfa-enrollment': MFAEnrollment,
  'forgot-password': ForgotPassword,
  'account-recovery': AccountRecovery,
  'auth-success': AuthSuccess,
  'profile-settings': ProfileSettings,
  'admin-users': AdminUserManagement,
  'auth-audit': AuthAudit,
  'design-guide': DesignSystemGuide,
  'avatar-showcase': AvatarShowcase,
};

export function AuthRoutes() {
  const navigate = useNavigate();
  const params = useParams<{ screen?: AuthScreen }>();

  const screenKey = params.screen ?? 'landing';
  const Component = SCREEN_COMPONENTS[screenKey] ?? AuthLanding;

  const handleNavigate = (next: AuthScreen) => {
    if (next === 'landing') {
      navigate('/auth');
      return;
    }
    navigate(`/auth/${next}`);
  };

  return <Component onNavigate={handleNavigate} />;
}

export default AuthRoutes;
