-- 移動の経路の詳細をメモと別に持つ（#1634）
ALTER TABLE `TravelPlan` ADD COLUMN `routeDetail` TEXT NULL;
