-- 公共交通の所要時間を「基準の電車の所要分 + 徒歩」で求めるため、徒歩の分を持たせる（#1458）。
ALTER TABLE `WorkRouteDefault` ADD COLUMN `walkMinutes` INTEGER NOT NULL DEFAULT 0;
