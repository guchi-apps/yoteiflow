-- 勤務場所ごとの正式名称の場所と省略名（#1382）。
CREATE TABLE `WorkPlaceLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `workPlace` VARCHAR(191) NOT NULL,
    `placeId` VARCHAR(191) NULL,
    `shortLabel2` VARCHAR(191) NULL,
    `shortLabel1` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WorkPlaceLink_userId_workPlace_key`(`userId`, `workPlace`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WorkPlaceLink` ADD CONSTRAINT `WorkPlaceLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
