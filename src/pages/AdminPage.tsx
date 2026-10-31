import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, Loader2, LogIn } from 'lucide-react';
import AdminDashboard from '../components/AdminDashboard';
import { SquareBackground } from '../components/ui/square-background';
import { MAIN_API } from '../config/runtime';

type GateState =
  | { status: 'checking' }
  | { status: 'granted'; role: 'admin' | 'uploader' }
  | { status: 'anonymous' }
  | { status: 'forbidden' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const [gate, setGate] = useState<GateState>({ status: 'checking' });
  const [bgMode] = useState<'combined' | 'static' | 'animated'>(() => {
    return (localStorage.getItem('settings_bg_mode') as 'combined' | 'static' | 'animated') || 'combined';
  });

  useEffect(() => {
    let cancelled = false;

    const checkAdminAuth = async () => {
      const authToken = localStorage.getItem('auth_token');
      if (!authToken) {
        if (!cancelled) setGate({ status: 'anonymous' });
        return;
      }

      try {
        const response = await fetch(`${MAIN_API}/api/admin/check`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (cancelled) return;

        if (response.ok) {
          const data = await response.json();
          const role = data.admin?.role === 'uploader' ? 'uploader' : 'admin';
          setGate({ status: 'granted', role });
          return;
        }

        if (response.status === 401) {
          setGate({ status: 'anonymous' });
          return;
        }
        if (response.status === 403) {
          setGate({ status: 'forbidden' });
          return;
        }
        if (response.status === 503) {
          setGate({ status: 'unavailable' });
          return;
        }

        setGate({ status: 'error', message: `HTTP ${response.status}` });
      } catch (error) {
        if (cancelled) return;
        console.error('Erreur lors de la vérification admin:', error);
        setGate({ status: 'unavailable' });
      }
    };

    checkAdminAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === 'checking') {
    return (
      <SquareBackground
        mode={bgMode}
        borderColor="rgba(255, 255, 255, 0.10)"
        className="min-h-screen bg-black text-white flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-hidden="true" />
          <p className="text-sm text-white/60">{t('admin.verifyingRights')}</p>
        </div>
      </SquareBackground>
    );
  }

  if (gate.status === 'granted') {
    return (
      <SquareBackground
        mode={bgMode}
        borderColor="rgba(255, 255, 255, 0.10)"
        className="min-h-screen bg-black text-white pt-20"
      >
        <AdminDashboard role={gate.role} />
      </SquareBackground>
    );
  }

  const copy = {
    anonymous: {
      icon: LogIn,
      title: t('admin.gate.anonymousTitle', 'Connexion requise'),
      body: t(
        'admin.gate.anonymousBody',
        'Aucune session active. Connectez-vous avec un compte de gestion pour ouvrir le panel.',
      ),
      action: { to: '/login?tab=password', label: t('admin.gate.signIn', 'Se connecter') },
    },
    forbidden: {
      icon: ShieldAlert,
      title: t('admin.gate.forbiddenTitle', 'Accès refusé'),
      body: t(
        'admin.gate.forbiddenBody',
        'Ce compte est bien connecté, mais il ne fait pas partie de l’équipe. Demandez à un admin de vous ajouter.',
      ),
      action: { to: '/', label: t('admin.gate.backHome', 'Retour à l’accueil') },
    },
    unavailable: {
      icon: ShieldAlert,
      title: t('admin.gate.unavailableTitle', 'Vérification impossible'),
      body: t(
        'admin.gate.unavailableBody',
        'Le service de vérification ne répond pas. Réessayez dans un instant — votre session n’est pas en cause.',
      ),
      action: { to: '/', label: t('admin.gate.backHome', 'Retour à l’accueil') },
    },
    error: {
      icon: ShieldAlert,
      title: t('admin.gate.errorTitle', 'Erreur inattendue'),
      body: t('admin.gate.errorBody', 'La vérification a échoué ({{message}}).', { message: gate.status === 'error' ? gate.message : '' }),
      action: { to: '/', label: t('admin.gate.backHome', 'Retour à l’accueil') },
    },
  }[gate.status];

  const Icon = copy.icon;

  return (
    <SquareBackground
      mode={bgMode}
      borderColor="rgba(255, 255, 255, 0.10)"
      className="min-h-screen bg-black text-white flex items-center justify-center px-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111] p-8 text-center">
        <div className="mx-auto mb-4 inline-flex rounded-full bg-white/5 p-3 ring-1 ring-white/10">
          <Icon className="h-6 w-6 text-white/80" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{copy.body}</p>
        <Link
          to={copy.action.to}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {copy.action.label}
        </Link>
      </div>
    </SquareBackground>
  );
};

export default AdminPage;
