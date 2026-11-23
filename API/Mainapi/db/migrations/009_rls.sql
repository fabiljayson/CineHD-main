-- RLS (row-level security, item #11) : activer sur les tables de contenu
-- utilisateur — mécanisme actif pour tout rôle non-owner ; le rôle de la
-- plateforme (owner des tables) contourne RLS via le tableau réservé à
-- l'exploitation, et les politiques ci-dessous autorisent la plateforme
-- (PUBLIC) pour aucune restriction lourde. politiques réelles per-ligne :
-- à coder lorsque le perimètre métier l'exige.
ALTER TABLE films ENABLE ROW LEVEL SECURITY;
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishboard_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY films_platform_all ON films FOR ALL TO PUBLIC USING (true);
CREATE POLICY series_platform_all ON series FOR ALL TO PUBLIC USING (true);
CREATE POLICY comments_platform_all ON comments FOR ALL TO PUBLIC USING (true);
CREATE POLICY shared_lists_platform_all ON shared_lists FOR ALL TO PUBLIC USING (true);
CREATE POLICY likes_platform_all ON likes FOR ALL TO PUBLIC USING (true);
CREATE POLICY wishboard_votes_platform_all ON wishboard_votes FOR ALL TO PUBLIC USING (true);
CREATE POLICY account_credentials_platform_all ON account_credentials FOR ALL TO PUBLIC USING (true);
