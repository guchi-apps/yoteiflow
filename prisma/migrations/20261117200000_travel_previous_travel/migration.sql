-- 再検索の続きとして登録した移動が、元の移動を指す列（#1642）
ALTER TABLE `TravelPlan` ADD COLUMN `previousTravelId` VARCHAR(191) NULL;
CREATE INDEX `TravelPlan_userId_previousTravelId_idx` ON `TravelPlan`(`userId`, `previousTravelId`);
