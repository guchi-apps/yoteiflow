-- よく使う電車に、出発地→行き先ごとのデフォルトと、Yahoo!乗換案内の経路詳細を持たせる（#1371）。
ALTER TABLE `WorkTrain` ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `note` TEXT NULL;
