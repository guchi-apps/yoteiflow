-- 勤務先の既定の移動を、移動方法ごとに持てるようにする（#1447）。
-- 組（出発地・行き先）ごとに方法別の行を持ち、isDefault の行が既定の方法。既存の行は1組1件なのでそのまま既定にする。
ALTER TABLE `WorkRouteDefault` ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT false;
UPDATE `WorkRouteDefault` SET `isDefault` = true;

-- userId の外部キーが旧い一意インデックスを使っているため、新しいものを作ってから旧いものを落とす。
CREATE UNIQUE INDEX `WorkRouteDefault_userId_origin_destination_mode_key` ON `WorkRouteDefault`(`userId`, `origin`, `destination`, `mode`);
DROP INDEX `WorkRouteDefault_userId_origin_destination_key` ON `WorkRouteDefault`;
