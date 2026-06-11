const express = require("express");
const router = express.Router();
const db = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/details", authMiddleware, async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const {
      business_name,
      company_number,
      vat_number,
      business_type,
      address_line1,
      address_line2,
      city,
      postcode,
      website,
    } = req.body;

    if (!business_name || !address_line1 || !city || !postcode) {
      return res.status(400).json({
        message: "Business name, address, city and postcode are required",
      });
    }

    const [existing] = await db.query(
      `
      SELECT business_id
      FROM business_details
      WHERE user_id = ?
      LIMIT 1
      `,
      [user_id]
    );

    if (existing.length) {
      await db.query(
        `
        UPDATE business_details
        SET
          business_name = ?,
          company_number = ?,
          vat_number = ?,
          business_type = ?,
          address_line1 = ?,
          address_line2 = ?,
          city = ?,
          postcode = ?,
          website = ?
        WHERE user_id = ?
        `,
        [
          business_name,
          company_number || null,
          vat_number || null,
          business_type || null,
          address_line1,
          address_line2 || null,
          city,
          postcode,
          website || null,
          user_id,
        ]
      );

      return res.json({
        message: "Business details updated successfully",
      });
    }

    await db.query(
      `
      INSERT INTO business_details 
      (
        user_id,
        business_name,
        company_number,
        vat_number,
        business_type,
        address_line1,
        address_line2,
        city,
        postcode,
        website
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        user_id,
        business_name,
        company_number || null,
        vat_number || null,
        business_type || null,
        address_line1,
        address_line2 || null,
        city,
        postcode,
        website || null,
      ]
    );

    res.status(201).json({
      message: "Business details saved successfully",
    });
  } catch (err) {
    console.error("Save business details error:", err);
    res.status(500).json({
      message: "Server error while saving business details",
    });
  }
});

router.get("/details", authMiddleware, async (req, res) => {
  try {
    const user_id = req.user.user_id;

    const [rows] = await db.query(
      `
      SELECT
        u.user_id,
        u.first_name,
        u.last_name,
        u.business_name AS user_business_name,
        u.email,
        u.phone,
        bd.business_id,
        bd.business_name,
        bd.company_number,
        bd.vat_number,
        bd.business_type,
        bd.address_line1,
        bd.address_line2,
        bd.city,
        bd.postcode,
        bd.website
      FROM users u
      LEFT JOIN business_details bd
        ON u.user_id = bd.user_id
      WHERE u.user_id = ?
      LIMIT 1
      `,
      [user_id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Customer details not found",
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Get business details error:", err);
    res.status(500).json({
      message: "Server error while loading business details",
    });
  }
});

router.put("/details", authMiddleware, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const user_id = req.user.user_id;

    const {
      first_name,
      last_name,
      email,
      phone,
      business_name,
      company_number,
      vat_number,
      business_type,
      address_line1,
      address_line2,
      city,
      postcode,
      website,
    } = req.body;

    if (!first_name || !last_name || !email || !phone) {
      await connection.rollback();
      return res.status(400).json({
        message: "First name, last name, email and phone are required",
      });
    }

    if (!business_name || !address_line1 || !city || !postcode) {
      await connection.rollback();
      return res.status(400).json({
        message: "Business name, address, city and postcode are required",
      });
    }

    await connection.query(
      `
      UPDATE users
      SET
        first_name = ?,
        last_name = ?,
        email = ?,
        phone = ?
      WHERE user_id = ?
      `,
      [first_name, last_name, email, phone, user_id]
    );

    const [existing] = await connection.query(
      `
      SELECT business_id
      FROM business_details
      WHERE user_id = ?
      LIMIT 1
      `,
      [user_id]
    );

    if (existing.length) {
      await connection.query(
        `
        UPDATE business_details
        SET
          business_name = ?,
          company_number = ?,
          vat_number = ?,
          business_type = ?,
          address_line1 = ?,
          address_line2 = ?,
          city = ?,
          postcode = ?,
          website = ?
        WHERE user_id = ?
        `,
        [
          business_name,
          company_number || null,
          vat_number || null,
          business_type || null,
          address_line1,
          address_line2 || null,
          city,
          postcode,
          website || null,
          user_id,
        ]
      );
    } else {
      await connection.query(
        `
        INSERT INTO business_details 
        (
          user_id,
          business_name,
          company_number,
          vat_number,
          business_type,
          address_line1,
          address_line2,
          city,
          postcode,
          website
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          user_id,
          business_name,
          company_number || null,
          vat_number || null,
          business_type || null,
          address_line1,
          address_line2 || null,
          city,
          postcode,
          website || null,
        ]
      );
    }

    await connection.commit();

    res.json({
      message: "Customer details updated successfully",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Update business details error:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This email address is already used by another account",
      });
    }

    res.status(500).json({
      message: "Server error while updating customer details",
    });
  } finally {
    connection.release();
  }
});

module.exports = router;