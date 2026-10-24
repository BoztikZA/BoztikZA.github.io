# Store Promotions

Store Promotions live in the existing Boztik Deliver D1 database and use the existing authenticated Command Centre session. Apply Worker migration `0008_store_promotions.sql` with the normal release process before the feature is used in production.

In Command Centre, open **Store Promotions**. Choose a store, complete the title, description, CTA and destination, then save as a draft or publish it. Uploading a replacement image keeps the record's other fields. Published Redbubble and TeePublic records can be selected for **New Releases**; Ko-fi wallpapers are blocked by the Worker from that surface.

Images uploaded after launch are stored privately in the existing R2 bucket and streamed only after the Worker confirms the promotion is published. Deleting a promotion removes its R2 image only when no other promotion references it. The initial nine images remain versioned site assets under `images/stores/`.
