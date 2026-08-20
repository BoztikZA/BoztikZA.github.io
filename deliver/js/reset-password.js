import { supabase } from "./shared.js";


const form =
  document.getElementById("reset-form");

const passwordInput =
  document.getElementById("password");

const confirmPasswordInput =
  document.getElementById("confirm-password");

const button =
  document.getElementById("reset-button");

const message =
  document.getElementById("message");


function showMessage(
  text,
  type = "error"
) {
  if (!message) {
    return;
  }

  message.textContent = text;

  message.className =
    `message ${type}`;
}


function setLoading(
  loading
) {
  if (!button) {
    return;
  }

  button.disabled = loading;

  button.classList.toggle(
    "loading",
    loading
  );

  button.textContent =
    loading
      ? "Updating password..."
      : "Update Password";
}


function getFriendlyError(
  error
) {
  if (!error) {
    return "Unable to update your password.";
  }

  const message =
    String(
      error.message ||
      error.error_description ||
      error.error ||
      ""
    ).toLowerCase();

  if (
    message.includes("expired") ||
    message.includes("otp") ||
    message.includes("invalid")
  ) {
    return (
      "This password reset link has expired or is no longer valid. " +
      "Please request a new password reset email."
    );
  }

  if (
    message.includes("password") &&
    message.includes("weak")
  ) {
    return (
      "Your new password is too weak. " +
      "Please use at least 8 characters."
    );
  }

  if (
    message.includes("same password")
  ) {
    return (
      "Your new password must be different from your current password."
    );
  }

  return (
    error.message ||
    "Unable to update your password. Please try again."
  );
}


/*
=========================================================
CHECK RESET SESSION
=========================================================
*/

async function checkResetSession() {

  try {

    const client =
      supabase();


    const {
      data,
      error
    } =
      await client.auth.getSession();


    if (error) {
      throw error;
    }


    /*
      Supabase normally processes the recovery
      session from the password-reset link before
      this page attempts updateUser().
    */

    if (!data?.session) {

      showMessage(
        "This password reset link is invalid or has expired. Please request a new password reset email.",
        "error"
      );

      return false;
    }


    return true;

  } catch (error) {

    console.error(
      "[Boztik Deliver] Password reset session check failed:",
      error
    );


    showMessage(
      getFriendlyError(error),
      "error"
    );


    return false;
  }
}


/*
=========================================================
PASSWORD UPDATE
=========================================================
*/

async function handlePasswordReset(
  event
) {

  event.preventDefault();


  showMessage(
    ""
  );


  const password =
    passwordInput?.value || "";

  const confirmPassword =
    confirmPasswordInput?.value || "";


  /*
  -------------------------------------------------------
  Validate password
  -------------------------------------------------------
  */

  if (!password) {

    showMessage(
      "Please enter a new password.",
      "error"
    );

    passwordInput?.focus();

    return;
  }


  if (password.length < 8) {

    showMessage(
      "Your new password must contain at least 8 characters.",
      "error"
    );

    passwordInput?.focus();

    return;
  }


  if (!confirmPassword) {

    showMessage(
      "Please confirm your new password.",
      "error"
    );

    confirmPasswordInput?.focus();

    return;
  }


  if (password !== confirmPassword) {

    showMessage(
      "The two passwords do not match.",
      "error"
    );

    confirmPasswordInput?.focus();

    return;
  }


  setLoading(true);


  try {

    const client =
      supabase();


    /*
    -------------------------------------------------------
    Confirm that the recovery session exists
    -------------------------------------------------------
    */

    const {
      data: sessionData,
      error: sessionError
    } =
      await client.auth.getSession();


    if (sessionError) {
      throw sessionError;
    }


    if (!sessionData?.session) {

      throw new Error(
        "Your password reset session is missing or has expired. Please request a new reset email."
      );
    }


    /*
    -------------------------------------------------------
    Update the authenticated user's password
    -------------------------------------------------------
    */

    const {
      error
    } =
      await client.auth.updateUser({
        password
      });


    if (error) {
      throw error;
    }


    /*
    -------------------------------------------------------
    Success
    -------------------------------------------------------
    */

    if (passwordInput) {
      passwordInput.value = "";
    }


    if (confirmPasswordInput) {
      confirmPasswordInput.value = "";
    }


    showMessage(
      "Your password has been updated successfully. You can now return to the Boztik Deliver Command Centre and sign in with your new password.",
      "success"
    );


    /*
    Give the user a moment to read the message,
    then return them to the dashboard.
    */

    window.setTimeout(
      () => {

        window.location.href =
          "./dashboard.html";

      },
      2500
    );


  } catch (error) {

    console.error(
      "[Boztik Deliver] Password update failed:",
      error
    );


    showMessage(
      getFriendlyError(error),
      "error"
    );


  } finally {

    setLoading(false);

  }
}


/*
=========================================================
SUPABASE AUTH STATE
=========================================================
*/

function listenForRecoverySession() {

  try {

    const client =
      supabase();


    /*
      Supabase can emit PASSWORD_RECOVERY when
      the recovery link establishes the session.
    */

    client.auth.onAuthStateChange(
      (event, session) => {

        console.log(
          "[Boztik Deliver] Auth event:",
          event
        );


        if (
          event === "PASSWORD_RECOVERY" &&
          session
        ) {

          showMessage(
            "Your reset link is valid. Enter your new password below.",
            "success"
          );

        }

      }
    );

  } catch (error) {

    console.error(
      "[Boztik Deliver] Could not initialise auth listener:",
      error
    );

  }
}


/*
=========================================================
INITIALISE
=========================================================
*/

async function initialise() {

  listenForRecoverySession();

  await checkResetSession();

}


if (form) {

  form.addEventListener(
    "submit",
    handlePasswordReset
  );

}


initialise();