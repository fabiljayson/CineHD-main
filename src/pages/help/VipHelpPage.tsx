import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Crown } from 'lucide-react';
import TutoLayout, { TutoSection } from '../../components/TutoLayout';
import TutoLink from '../../components/TutoLink';

const VipHelpPage: React.FC = () => {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = `${t('help.vip.title')} — CineHD`;
  }, [t]);

  const sections: TutoSection[] = [
    {
      kind: 'text',
      bodyKey: 'help.vip.introBody',
    },
    {
      kind: 'text',
      titleKey: 'help.vip.perksTitle',
      bodyKey: 'help.vip.perksBody',
      components: {
        1: <TutoLink to="/help/watchparty" />,
      },
    },
    {
      kind: 'text',
      titleKey: 'help.vip.includedTitle',
      bodyKey: 'help.vip.includedBody',
    },
    {
      kind: 'text',
      titleKey: 'help.vip.invoicesTitle',
      bodyKey: 'help.vip.invoicesBody',
      components: {
        1: <TutoLink to="/vip/invoices" />,
      },
    },
  ];

  return (
    <TutoLayout
      icon={<Crown className="w-10 h-10 text-yellow-400" />}
      title={t('help.vip.title')}
      heroSub={t('help.vip.heroSub')}
      sections={sections}
    />
  );
};

export default VipHelpPage;
