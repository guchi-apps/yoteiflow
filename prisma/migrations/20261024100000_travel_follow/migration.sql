-- 予定変更後の再提案のため、検索したときの予定の状態と「今は変更しない」の印を持つ（#1332）。
ALTER TABLE `TravelPlan`
  ADD COLUMN `searchEventStart` DATETIME(3) NULL,
  ADD COLUMN `searchEventEnd` DATETIME(3) NULL,
  ADD COLUMN `searchEventLocation` TEXT NULL,
  ADD COLUMN `followDismissedKey` VARCHAR(512) NULL;
