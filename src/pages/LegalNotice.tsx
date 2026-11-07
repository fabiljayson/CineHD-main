import {
  Building2,
  Copyright,
  Landmark,
  Mail,
  Server,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import LegalDocumentPage, { LegalSection } from '../components/legal/LegalDocumentPage';

const CONTACT_EMAIL = 'jasonfranckkenmognw@gmail.com';

const LegalNotice = () => {
  const { t } = useTranslation();

  const getStringArray = (key: string): string[] => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) ? (value as string[]) : [];
  };

  const getOptionalStringArray = (key: string): string[] | undefined => {
    const value = t(key, { returnObjects: true });
    return Array.isArray(value) && value.length > 0 ? (value as string[]) : undefined;
  };

  const getOptionalString = (key: string): string | undefined => {
    const value = t(key);
    return value === key ? undefined : value;
  };

  const sections: LegalSection[] = [
    {
      id: 'publisher',
      title: t('legalNoticePage.sections.publisher.title'),
      icon: Building2,
      paragraphs: getOptionalStringArray('legalNoticePage.sections.publisher.paragraphs'),
      bullets: getOptionalStringArray('legalNoticePage.sections.publisher.bullets'),
      note: getOptionalString('legalNoticePage.sections.publisher.note'),
    },
    {
      id: 'hosting',
      title: t('legalNoticePage.sections.hosting.title'),
      icon: Server,
      paragraphs: getOptionalStringArray('legalNoticePage.sections.hosting.paragraphs'),
      bullets: getOptionalStringArray('legalNoticePage.sections.hosting.bullets'),
      note: getOptionalString('legalNoticePage.sections.hosting.note'),
    },
    {
      id: 'intellectual-property',
      title: t('legalNoticePage.sections.intellectualProperty.title'),
      icon: Copyright,
      paragraphs: getOptionalStringArray('legalNoticePage.sections.intellectualProperty.paragraphs'),
      bullets: getOptionalStringArray('legalNoticePage.sections.intellectualProperty.bullets'),
      note: getOptionalString('legalNoticePage.sections.intellectualProperty.note'),
    },
    {
      id: 'contact',
      title: t('legalNoticePage.sections.contact.title'),
      icon: Mail,
      paragraphs: getOptionalStringArray('legalNoticePage.sections.contact.paragraphs'),
      bullets: getOptionalStringArray('legalNoticePage.sections.contact.bullets'),
      note: getOptionalString('legalNoticePage.sections.contact.note'),
    },
  ];

  return (
    <LegalDocumentPage
      title={t('legalNoticePage.title')}
      eyebrow={t('legalNoticePage.eyebrow')}
      lastUpdated={t('legalNoticePage.lastUpdated')}
      seoTitle={t('legalNoticePage.seoTitle')}
      seoDescription={t('legalNoticePage.seoDescription')}
      canonicalPath="/mentions-legales"
      heroIcon={Landmark}
      intro={getStringArray('legalNoticePage.intro')}
      summaryItems={getStringArray('legalNoticePage.summaryItems')}
      sections={sections}
      supportCard={{
        title: t('legalNoticePage.supportCard.title'),
        paragraphs: getStringArray('legalNoticePage.supportCard.paragraphs'),
        actions: [
          { label: t('legalNoticePage.supportCard.actions.terms'), to: '/terms-of-service', variant: 'primary' },
          { label: t('legalNoticePage.supportCard.actions.privacy'), to: '/privacy', variant: 'secondary' },
          { label: t('legalNoticePage.supportCard.actions.email'), href: `mailto:${CONTACT_EMAIL}`, variant: 'ghost' },
        ],
      }}
      footerNote={t('legalNoticePage.footerNote')}
    />
  );
};

export default LegalNotice;
