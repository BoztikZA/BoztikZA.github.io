-- Store promotions are public only when status = published. Images are either
-- stable site assets (the first nine records) or private R2 objects streamed by
-- the Worker after the promotion's public status is checked.
CREATE TABLE IF NOT EXISTS store_promotions (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL CHECK (store IN ('redbubble','teepublic','kofi')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL,
  cta_label TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  image_content_type TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  homepage_featured INTEGER NOT NULL DEFAULT 0 CHECK (homepage_featured IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_promotions_public ON store_promotions(status, store, sort_order);

-- Initial artwork remains versioned with the site; all later image uploads use
-- the authenticated Worker/R2 path. Ko-fi rows are deliberately not featured.
INSERT OR IGNORE INTO store_promotions (id,store,title,description,destination_url,cta_label,image_ref,status,homepage_featured,sort_order,created_at,updated_at) VALUES
 ('sp-rb-01','redbubble','Coffee Time print','A warm, playful coffee illustration for everyday creative spaces.','https://www.redbubble.com/people/Boztik-Designs/shop','Shop Redbubble','/images/stores/redtee1.jpg','published',1,10,1761264000,1761264000),
 ('sp-rb-02','redbubble','Rule #1 graphic tee','A bold motorsport-inspired graphic in a relaxed black tee mock-up.','https://www.redbubble.com/people/Boztik-Designs/shop','Shop Redbubble','/images/stores/redtee2.jpg','published',1,20,1761264000,1761264000),
 ('sp-rb-03','redbubble','Rule #1 alternate fit','The Rule #1 design shown in a second oversized tee styling.','https://www.redbubble.com/people/Boztik-Designs/shop','Shop Redbubble','/images/stores/redtee3.jpg','published',0,30,1761264000,1761264000),
 ('sp-tp-01','teepublic','Still Loading sweatshirt','A clean retro-future sweatshirt graphic for slow mornings and fast ideas.','https://www.teepublic.com/user/boztik-designs','Shop TeePublic','/images/stores/redtee4.jpg','published',1,10,1761264000,1761264000),
 ('sp-tp-02','teepublic','Coffee Fanatic phone case','A strong coffee-themed design with a rich illustrated finish.','https://www.teepublic.com/user/boztik-designs','Shop TeePublic','/images/stores/redtee5.jpg','published',0,20,1761264000,1761264000),
 ('sp-tp-03','teepublic','Analog Heart design','A floral analog-heart illustration for creators with a digital mind.','https://www.teepublic.com/user/boztik-designs','Shop TeePublic','/images/stores/redtee7.jpg','published',0,30,1761264000,1761264000),
 ('sp-kofi-01','kofi','Inferno Silk wallpaper pack','A vivid orange-and-black abstract wallpaper collection.','https://ko-fi.com/boztik/shop','Get Wallpapers','/images/stores/Wallpaper1.png','published',0,10,1761264000,1761264000),
 ('sp-kofi-02','kofi','Soft sand wallpaper pack','A calm, dimensional wallpaper set for phone, tablet and desktop.','https://ko-fi.com/boztik/shop','Get Wallpapers','/images/stores/Wallpaper 2.png','published',0,20,1761264000,1761264000),
 ('sp-kofi-03','kofi','Nocturne red wallpaper pack','A dark, cinematic red wallpaper collection across your devices.','https://ko-fi.com/boztik/shop','Get Wallpapers','/images/stores/Wallpaper 3.png','published',0,30,1761264000,1761264000);
