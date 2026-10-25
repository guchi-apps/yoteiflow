-- 勤務の往路・復路で選ぶ「よく使う電車」（#1347）。
CREATE TABLE `WorkTrain` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `origin` VARCHAR(191) NOT NULL,
  `destination` VARCHAR(191) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `departMinutes` INTEGER NOT NULL,
  `durationMinutes` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `WorkTrain_userId_origin_destination_idx`(`userId`, `origin`, `destination`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkTrain` ADD CONSTRAINT `WorkTrain_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
